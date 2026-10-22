import { one, run, logEvent } from "@/lib/db";
import type { Business } from "@/lib/auth";
import { normalizePhone, isValidUsPhone, prettyPhone } from "@/lib/phone";
import { logConversation } from "@/lib/conversations";
import { pushToBusiness } from "@/lib/push";
import { lane, sendToCustomer } from "@/lib/sms";
import { recordConsent } from "@/lib/consent";
import { sendSms, twilioConfigured } from "@/lib/twilio";
import { NAME, SITE } from "@/lib/whitelabel";

// The estimate / contact form on a client's website posts here (plain HTML form or fetch).
// What happens, in order:
//   0. the lead is labeled with where it came from: hidden `source` from the page (the site's
//      first-touch script: "Google Ads", "Google search", "Direct"...), else gclid / utm_medium=cpc
//      means Google Ads, else "Website". The label leads every alert so ads leads are told apart.
//   1. the lead is stored, added to the owner's customers (no review text is scheduled: they are
//      not a customer yet) and shows up in the app's Texts inbox with the form details
//   2. the owner's phone gets a push ("New lead from your website")
//   3. every number in businesses.lead_alert_phones gets a text from the business line
//   4. if the person ticked the consent box, they get the business's auto-reply text
// Redirects back to the form's page (?sent=1) for HTML forms; JSON for fetch.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const DEFAULT_REPLY = "Hi {first_name}, this is {business}. We got your request and will call or text you shortly. Reply STOP to opt out.";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const b = await one<Business>("SELECT * FROM businesses WHERE slug=? AND status IN ('active','trial')", [slug]);
  if (!b) return json({ error: "unknown business" }, 404);

  const ct = req.headers.get("content-type") ?? "";
  let f: Record<string, string> = {};
  try {
    if (ct.includes("application/json")) f = Object.fromEntries(Object.entries(await req.json()).map(([k, v]) => [k, String(v ?? "")]));
    else f = Object.fromEntries(Array.from((await req.formData()).entries()).map(([k, v]) => [k, String(v)]));
  } catch {
    return json({ error: "bad form" }, 400);
  }
  const wantsJson = ct.includes("application/json") || Boolean(req.headers.get("accept")?.includes("application/json"));
  const back = (q: string) => {
    // Only ever bounce back to the business's own website.
    const home = b.website || (process.env.BASE_URL ?? SITE);
    const to = f.redirect || req.headers.get("referer") || home;
    const origin = (u: string) => { try { return new URL(u).origin; } catch { return ""; } };
    const target = b.website && origin(to) === origin(b.website) ? to : home;
    // Keep the query ahead of any #anchor so the page script can read it.
    const [base, hash] = target.split("#");
    return Response.redirect(`${base}${base.includes("?") ? "&" : "?"}${q}${hash ? `#${hash}` : ""}`, 303);
  };

  // Bot check: the page stamps _t at render; a submit under 2 seconds later is not a person.
  // Missing _t (no JS) is allowed so a real lead is never lost.
  const renderedAt = Number(f._t ?? 0);
  if (renderedAt && Date.now() - renderedAt < 2000) return wantsJson ? json({ ok: true }) : back("sent=1");

  const name = (f.name ?? "").trim().slice(0, 80);
  const phone = normalizePhone(f.phone ?? "");
  if (!isValidUsPhone(phone)) return wantsJson ? json({ error: "Enter a valid phone number." }, 400) : back("error=phone");
  const city = (f.city ?? "").trim().slice(0, 80);
  const service = (f.service ?? "").trim().slice(0, 80);
  const message = (f.message ?? "").trim().slice(0, 1000);
  const consent = ["on", "true", "1"].includes(f.consent ?? "");
  const sourceUrl = (f.redirect || req.headers.get("referer") || "").slice(0, 300);
  const gclid = (f.gclid || f.gbraid || f.wbraid || "").trim().slice(0, 120);
  const source = leadSource(f, gclid);

  await run("INSERT INTO leads (business_id, name, phone, city, service, message, source_url, source, gclid, consent, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
    b.id, name, phone, city, service, message, sourceUrl, source, gclid, consent ? 1 : 0, req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "", (req.headers.get("user-agent") ?? "").slice(0, 300),
  ]);
  await run(
    `INSERT INTO customers (business_id, name, phone, source) VALUES (?,?,?,'website')
     ON CONFLICT(business_id, phone) DO UPDATE SET name = CASE WHEN customers.name = '' THEN excluded.name ELSE customers.name END`,
    [b.id, name, phone]
  );

  // 1) The form details open (or continue) that person's thread in the Texts inbox.
  const summary = [`${source} lead${name ? ` from ${name}` : ""}`, service ? `Service: ${service}` : "", city ? `City: ${city}` : "", message ? `"${message}"` : ""].filter(Boolean).join("\n");
  await logConversation({ businessId: b.id, phone, direction: "in", body: summary, sid: "web-lead" });
  const line = [name || prettyPhone(phone), service, city].filter(Boolean).join(" · ");
  await logEvent(b.id, "web_lead", `${source}: ${line}`);

  // 2) Push the owner.
  await pushToBusiness(b.id, { title: `New ${source} lead${name ? `: ${name}` : ""}`, body: [service, city].filter(Boolean).join(" · ") || prettyPhone(phone), threadId: phone, data: { kind: "text", phone } }).catch(() => 0);

  // 3) Text everyone who should hear about a lead right away. A lead is the one thing that
  // must not wait for someone to notice a badge.
  const l = b.demo ? null : lane(b);
  const alertTo = (b.lead_alert_phones || b.owner_phone || "").split(",").map((p) => normalizePhone(p)).filter(isValidUsPhone);
  if (l && twilioConfigured()) {
    const body = `New ${source} lead: ${line}. Their number: ${prettyPhone(phone)}.${message ? ` "${message.slice(0, 200)}"` : ""} Open the ${NAME} app to reply.`;
    await Promise.all(alertTo.map(async (to) => {
      const r = await sendSms({ ...l, to, body }).then((m) => ({ ok: 1, detail: m.sid })).catch((err) => ({ ok: 0, detail: err instanceof Error ? err.message : String(err) }));
      await run("INSERT INTO messages (business_id, lane, to_phone, body, ok, detail) VALUES (?,?,?,?,?,?)", [b.id, "lead-alert", to, body, r.ok, r.detail.slice(0, 300)]);
    }));
  }

  // 4) Auto-reply, only with consent (TCPA), recorded like any other opt-in.
  if (consent) {
    await recordConsent({ businessId: b.id, businessName: b.name, phone, name, sourceUrl, req });
    const text = (b.web_lead_text.trim() || DEFAULT_REPLY).replaceAll("{business}", b.name).replaceAll("{first_name}", name.split(/\s+/)[0] ?? "").replaceAll("{name}", name).replace(/^Hi ,/, "Hi,");
    await sendToCustomer(b, phone, text).catch((err) => console.error("[lead] auto-reply failed:", err));
  }

  return wantsJson ? json({ ok: true }) : back("sent=1");
}

// Where the lead came from, as a short label that leads the alert text. The page's hidden
// `source` wins (the site script reads gclid / utm / document.referrer on the first page view and
// keeps it for the session). Without it: a Google click id or paid utm means Google Ads.
function leadSource(f: Record<string, string>, gclid: string): string {
  const given = (f.source ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (given) {
    if (/ads|cpc|ppc|paid/i.test(given)) return "Google Ads";
    return given;
  }
  if (gclid || /^(cpc|ppc|paid|paidsearch)$/i.test((f.utm_medium ?? "").trim())) return "Google Ads";
  if (/google/i.test(f.utm_source ?? "")) return "Google search";
  return "Website";
}
