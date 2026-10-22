// Square / Stripe / Calendly / Acuity / anything → a queued review request.
// The URL token identifies the business; the signing secret (when set) proves
// the sender. Always answer 200 to a well-formed call so providers don't
// retry forever; the outcome is reported in the JSON and logged as an event.

import { json, fail } from "@/lib/api";
import { one, run, logEvent } from "@/lib/db";
import { PROVIDERS, extract, verifyStripeSignature, verifySquareSignature, type Provider } from "@/lib/integrations";
import { addCustomerAndQueue } from "@/lib/requests";
import type { Business } from "@/lib/auth";
import { pushToBusiness } from "@/lib/push";

type Integration = { id: number; business_id: number; provider: string; signing_secret: string; enabled: number };

export async function GET() {
  return json({ ok: true, hint: "POST your provider's webhook here" });
}

export async function POST(req: Request, ctx: { params: Promise<{ provider: string; token: string }> }) {
  const { provider, token } = await ctx.params;
  if (!PROVIDERS.includes(provider as Provider)) return fail("Unknown provider", 404);
  const integ = await one<Integration>("SELECT * FROM integrations WHERE token=? AND provider=?", [token, provider]);
  if (!integ) return fail("Unknown webhook", 404);
  if (!integ.enabled) return json({ ok: true, outcome: "disabled" });

  const raw = await req.text();
  if (provider === "stripe" && !verifyStripeSignature(raw, req.headers.get("stripe-signature") ?? "", integ.signing_secret)) return fail("Bad signature", 401);
  if (provider === "square" && !verifySquareSignature(raw, req.url, req.headers.get("x-square-hmacsha256-signature") ?? "", integ.signing_secret)) return fail("Bad signature", 401);

  let parsed: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) parsed = Object.fromEntries(new URLSearchParams(raw));
  else {
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return fail("Body must be JSON", 400);
    }
  }

  await run("UPDATE integrations SET events=events+1, last_event_at=datetime('now') WHERE id=?", [integ.id]);
  const hit = extract(provider as Provider, parsed);
  if (!hit) return json({ ok: true, outcome: "ignored", reason: "no phone number or unhandled event type" });

  const b = await one<Business>("SELECT * FROM businesses WHERE id=?", [integ.business_id]);
  if (!b) return fail("Business missing", 404);
  const r = await addCustomerAndQueue(b, { name: hit.name, phone: hit.phone, email: hit.email, source: provider });
  if (r.outcome === "queued" && r.request) {
    await logEvent(b.id, "webhook", `${hit.name || hit.phone} from ${provider} (${hit.event})`);
    // Nobody typed this customer in, so tell the owner while the buffer is still open: a bad visit can be stopped from Home.
    const mins = Math.round((new Date(r.request.send_at.replace(" ", "T") + "Z").getTime() - Date.now()) / 60_000);
    if (mins >= 5) {
      const wait = mins >= 90 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`;
      await pushToBusiness(b.id, { title: `${hit.name || "A customer"} gets a review text in ${wait}`, body: "Rough visit? Open the app and stop it before it sends.", data: { kind: "scheduled" }, threadId: "scheduled" });
    }
  }
  return json({ ok: true, outcome: r.outcome, request_id: r.request?.id ?? null });
}
