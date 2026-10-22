// The client's website is part of the product: the review link in our texts and the quote
// links live on their domain, and the site shows the reviews we sync. So once a day we make
// sure the site answers and the rewrite to us still works, and we rebuild the site when a
// new review lands. Results sit on the business row and feed the health flags.

import { all, run, logEvent } from "./db";
import type { Business } from "./auth";
import { baseUrl } from "./template";

export const GATE_OK = "happy-mouths-gate-ok";

async function get(url: string, ms = 12000): Promise<{ status: number; text: string; ms: number }> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "SiteCheck/1.0" }, cache: "no-store" });
    return { status: r.status, text: (await r.text()).slice(0, 4000), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

export type SiteResult = { ok: boolean; detail: string };

/** One business: homepage up, and if the review link lives on their domain, the rewrite reaches us. */
export async function checkSite(b: Pick<Business, "website" | "gate_url">): Promise<SiteResult> {
  if (!b.website) return { ok: true, detail: "no website on file" };
  try {
    const home = await get(b.website);
    if (home.status >= 400) return { ok: false, detail: `Homepage answered ${home.status}` };
    if (!home.text.trim()) return { ok: false, detail: "Homepage answered empty" };
  } catch (err) {
    return { ok: false, detail: `Homepage unreachable: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160) };
  }
  if (b.gate_url) {
    try {
      const gate = await get(b.gate_url.replace(/\/$/, "") + "/check");
      if (gate.status >= 400 || !gate.text.includes(GATE_OK)) return { ok: false, detail: `Review link on their site is not reaching us (${gate.status}). Check the /review rewrite in their vercel.json.` };
      // The review page's styles and scripts load from /_next on THEIR domain; without that rewrite the page shows up unstyled.
      const css = (await get(`${baseUrl()}/`)).text.match(/\/_next\/static\/[^"']+\.css/)?.[0];
      if (css) {
        const asset = await get(new URL(b.gate_url).origin + css);
        if (asset.status >= 400) return { ok: false, detail: `Review page on their site loads without its styles (${asset.status}). Add the /_next/:path* rewrite to their vercel.json.` };
      }
    } catch (err) {
      return { ok: false, detail: `Review link on their site unreachable: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160) };
    }
  }
  return { ok: true, detail: b.gate_url ? "Site up, review link reaches us" : "Site up" };
}

export async function checkAllSites(): Promise<Record<string, SiteResult>> {
  const list = await all<Business>("SELECT * FROM businesses WHERE demo=0 AND status IN ('active','trial') AND website != ''");
  const out: Record<string, SiteResult> = {};
  for (const b of list) {
    const r = await checkSite(b);
    out[b.slug] = r;
    const was = Number(b.site_ok ?? 1);
    await run("UPDATE businesses SET site_ok=?, site_detail=?, site_checked_at=datetime('now') WHERE id=?", [r.ok ? 1 : 0, r.detail, b.id]);
    if (!r.ok && was) await logEvent(b.id, "site_down", r.detail);
    if (r.ok && !was) await logEvent(b.id, "site_up", "Website back to normal");
  }
  return out;
}

/** Ask Vercel to rebuild the client's site (their build pulls our public review feed). */
export async function redeploySite(b: Pick<Business, "id" | "name" | "site_deploy_hook">, why: string): Promise<boolean> {
  if (!b.site_deploy_hook) return false;
  try {
    const r = await fetch(b.site_deploy_hook, { method: "POST" });
    await logEvent(b.id, "site_redeploy", r.ok ? `Rebuilding the website: ${why}` : `Rebuild request failed (${r.status}): ${why}`);
    return r.ok;
  } catch (err) {
    await logEvent(b.id, "site_redeploy", `Rebuild request failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    return false;
  }
}
