// Meta (Facebook/Instagram) Lead Ads → a text to whoever runs your sales.
// This is OUR lead flow, not a client's: your own ad campaign runs an
// instant form, Meta calls /api/hooks/meta with the leadgen id, we pull the
// answers from the Graph API and text them out on a registered A2P line.
//
// Env:
//   META_APP_SECRET        app secret, verifies X-Hub-Signature-256 on every call
//   META_VERIFY_TOKEN      any string; Meta echoes it back on the GET handshake
//   META_PAGE_TOKEN        long-lived Page access token with leads_retrieval
//   HM_LEAD_ALERT_PHONES   comma list of team cells to text (required to get alerts). Every
//                          internal alert uses it, not just Meta leads (see alertOps in lib/sms.ts).
//   HM_LEAD_ALERT_FROM     slug of the business whose registered line sends (HM_LEAD_ALERT_FROM)

import { createHmac, timingSafeEqual } from "node:crypto";
import { one, run } from "./db";
import type { Business } from "./auth";
import { lane } from "./sms";
import { sendSms, twilioConfigured } from "./twilio";
import { normalizePhone, isValidUsPhone, prettyPhone } from "./phone";
import { NAME } from "@/lib/whitelabel";

const GRAPH = "https://graph.facebook.com/v21.0";
export const ALERT_TO = (process.env.HM_LEAD_ALERT_PHONES || "+15555550100,+15555550101").split(",").map((p) => normalizePhone(p.trim())).filter(isValidUsPhone);
export const FROM_SLUG = process.env.HM_LEAD_ALERT_FROM ?? "";

export function verifyMetaSignature(rawBody: string, header: string): boolean {
  const secret = process.env.META_APP_SECRET ?? "";
  if (!secret) return false;
  const [algo, hex] = (header ?? "").split("=");
  if (algo !== "sha256" || !hex) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(hex);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type LeadChange = { leadgen_id: string; page_id: string; form_id: string; ad_id: string; created_time: number };

/** Pull every leadgen change out of a webhook body; Meta batches entries and retries on non-200. */
export function leadChanges(body: unknown): LeadChange[] {
  const out: LeadChange[] = [];
  const b = body as { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };
  if (b?.object !== "page") return out;
  for (const e of b.entry ?? []) {
    for (const c of e.changes ?? []) {
      if (c.field !== "leadgen" || !c.value) continue;
      const v = c.value;
      const id = String(v.leadgen_id ?? "");
      if (!id) continue;
      out.push({ leadgen_id: id, page_id: String(v.page_id ?? ""), form_id: String(v.form_id ?? ""), ad_id: String(v.ad_id ?? ""), created_time: Number(v.created_time ?? 0) });
    }
  }
  return out;
}

export type LeadDetails = { name: string; phone: string; email: string; ad_name: string; campaign_name: string; fields: Record<string, string> };

const pick = (fields: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const hit = Object.entries(fields).find(([name]) => name.toLowerCase().includes(k));
    if (hit?.[1]) return hit[1];
  }
  return "";
};

/** Instant-form answers live behind the Graph API; the webhook only carries ids. */
export async function fetchLead(leadgenId: string): Promise<LeadDetails> {
  const token = process.env.META_PAGE_TOKEN ?? "";
  if (!token) throw new Error("META_PAGE_TOKEN not set");
  const res = await fetch(`${GRAPH}/${leadgenId}?fields=created_time,field_data,ad_name,campaign_name,adset_name,form_id,platform&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) });
  const j = (await res.json()) as { error?: { message?: string }; field_data?: Array<{ name: string; values: string[] }>; ad_name?: string; campaign_name?: string };
  if (!res.ok || j.error) throw new Error(j.error?.message ?? `Graph ${res.status}`);
  const fields: Record<string, string> = {};
  for (const f of j.field_data ?? []) fields[f.name] = (f.values ?? []).filter(Boolean).join(", ");
  const first = pick(fields, "first_name"), last = pick(fields, "last_name");
  const name = pick(fields, "full_name") || [first, last].filter(Boolean).join(" ") || pick(fields, "name");
  return { name, phone: normalizePhone(pick(fields, "phone")), email: pick(fields, "email"), ad_name: j.ad_name ?? "", campaign_name: j.campaign_name ?? "", fields };
}

export function alertText(d: Partial<LeadDetails>, leadgenId: string, fetchError = ""): string {
  if (fetchError) return `New ${NAME} lead from Meta ads (lead ${leadgenId}). Could not pull the details: ${fetchError.slice(0, 120)}. Check Meta Leads Center.`;
  const skip = new Set(["full_name", "first_name", "last_name", "phone_number", "email"]);
  const extras = Object.entries(d.fields ?? {}).filter(([k, v]) => v && !skip.has(k)).map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`);
  const who = d.name || "Someone";
  const phone = d.phone && isValidUsPhone(d.phone) ? prettyPhone(d.phone) : d.phone || "no phone";
  return [`New ${NAME} lead from Meta ads: ${who}, ${phone}${d.email ? `, ${d.email}` : ""}.`, extras.length ? extras.join(" · ") : "", d.ad_name ? `Ad: ${d.ad_name}` : ""].filter(Boolean).join(" ");
}

/** Text every alert number from the registered line. Returns "ok" or the first error. */
export async function textAlert(body: string, logLane = "meta-lead"): Promise<{ ok: boolean; detail: string }> {
  const b = await one<Business>("SELECT * FROM businesses WHERE slug=?", [FROM_SLUG]);
  const l = b ? lane(b) : null;
  if (!b || !l) return { ok: false, detail: `no messaging lane for ${FROM_SLUG}` };
  if (!ALERT_TO.length) return { ok: false, detail: "HM_LEAD_ALERT_PHONES empty" };
  if (process.env.SMS_DRY_RUN === "true") {
    console.log(`[sms dry-run] ${logLane} → ${ALERT_TO.join(",")}: ${body}`);
    return { ok: true, detail: "dry-run" };
  }
  if (!twilioConfigured()) return { ok: false, detail: "Twilio not configured" };
  const results = await Promise.all(ALERT_TO.map(async (to) => {
    const r = await sendSms({ ...l, to, body }).then((m) => ({ ok: true, detail: m.sid })).catch((err: unknown) => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }));
    await run("INSERT INTO messages (business_id, lane, to_phone, body, ok, detail) VALUES (?,?,?,?,?,?)", [b.id, logLane, to, body, r.ok ? 1 : 0, r.detail.slice(0, 300)]);
    return r;
  }));
  const bad = results.find((r) => !r.ok);
  return bad ?? { ok: true, detail: results.map((r) => r.detail).join(",") };
}

/** One lead → one text, even when Meta retries the webhook. */
export async function handleLead(c: LeadChange): Promise<{ outcome: string; detail: string }> {
  const seen = await one("SELECT alerted FROM meta_leads WHERE leadgen_id=?", [c.leadgen_id]);
  if (seen?.alerted) return { outcome: "duplicate", detail: "" };

  let d: LeadDetails | null = null;
  let fetchError = "";
  try {
    d = await fetchLead(c.leadgen_id);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }
  const text = alertText(d ?? {}, c.leadgen_id, fetchError);
  const r = await textAlert(text);
  await run(
    `INSERT INTO meta_leads (leadgen_id, page_id, form_id, ad_id, ad_name, campaign_name, name, phone, email, fields_json, fetch_error, alerted, alert_detail)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(leadgen_id) DO UPDATE SET alerted=excluded.alerted, alert_detail=excluded.alert_detail, fetch_error=excluded.fetch_error,
       name=excluded.name, phone=excluded.phone, email=excluded.email, fields_json=excluded.fields_json, ad_name=excluded.ad_name, campaign_name=excluded.campaign_name`,
    [c.leadgen_id, c.page_id, c.form_id, c.ad_id, d?.ad_name ?? "", d?.campaign_name ?? "", d?.name ?? "", d?.phone ?? "", d?.email ?? "", JSON.stringify(d?.fields ?? {}), fetchError.slice(0, 300), r.ok ? 1 : 0, r.detail.slice(0, 300)]
  );
  return { outcome: r.ok ? "texted" : "text-failed", detail: r.detail };
}
