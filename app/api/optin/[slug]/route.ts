import { one, run, logEvent } from "@/lib/db";
import type { Business } from "@/lib/auth";
import { normalizePhone, isValidUsPhone } from "@/lib/phone";
import { sendToCustomer } from "@/lib/sms";
import { recordConsent } from "@/lib/consent";

// The "sign up for texts" form on a business's own website posts here as a plain HTML form, no
// JavaScript needed. We record the consent, send the confirmation text the carrier registration
// promises, and send the browser back to that page with ?ok=1 or ?error=1. The way back is pinned
// to the business's own website so this can never bounce anywhere else.
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const b = await one<Business>("SELECT * FROM businesses WHERE slug=? AND status IN ('active','trial')", [slug]);
  if (!b || !b.website) return Response.json({ error: "Unknown sign-up page" }, { status: 404 });
  const origin = (u: string) => { try { return new URL(u).origin; } catch { return ""; } };
  const from = req.headers.get("referer") ?? "";
  const page = (origin(from) === origin(b.website) ? from : b.website).split(/[?#]/)[0];
  const back = (q: string) => Response.redirect(`${page}?${q}`, 303);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return back("error=1");
  }
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  if (form.get("consent") !== "on" || !isValidUsPhone(phone)) return back("error=1");
  const name = String(form.get("name") ?? "").trim().slice(0, 80);

  await recordConsent({ businessId: b.id, businessName: b.name, phone, name, sourceUrl: page, req });
  await run(
    `INSERT INTO customers (business_id, name, phone, source) VALUES (?,?,?,'website')
     ON CONFLICT(business_id, phone) DO UPDATE SET name = CASE WHEN customers.name = '' THEN excluded.name ELSE customers.name END`,
    [b.id, name, phone]
  );
  await logEvent(b.id, "opt_in", `${name || phone} signed up for texts on the website`);
  await sendToCustomer(b, phone, `${b.name}: You are now subscribed to text updates about your service request. Message frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe, HELP for help.`).catch(() => {});
  return back("ok=1");
}
