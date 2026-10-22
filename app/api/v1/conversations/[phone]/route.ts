// One customer's thread: read it (which marks it read), reply as the business
// (text, or a photo as multipart), or name the customer.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all, one, run } from "@/lib/db";
import { normalizePhone, isValidUsPhone } from "@/lib/phone";
import { sendToCustomer, isOptedOut } from "@/lib/sms";
import { isBlocked } from "@/lib/dnc";
import { parseMedia } from "@/lib/conversations";
import { storeUpload } from "@/lib/media";

export const OPTIONS = preflight;
type Ctx = { params: Promise<{ phone: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_messages) return fail("Customer texts are not on for this account.", 404);
  const phone = normalizePhone(decodeURIComponent((await ctx.params).phone));
  await run("UPDATE conversation_messages SET read_at=datetime('now') WHERE business_id=? AND customer_phone=? AND direction='in' AND read_at IS NULL", [b.id, phone]);
  const rows = await all<{ id: number; direction: string; body: string; media_urls: string; created_at: string }>(
    "SELECT id, direction, body, media_urls, created_at FROM (SELECT * FROM conversation_messages WHERE business_id=? AND customer_phone=? AND automated=0 ORDER BY id DESC LIMIT 300) ORDER BY id ASC",
    [b.id, phone]
  );
  const customer = await one<{ id: number; name: string }>("SELECT id, name FROM customers WHERE business_id=? AND phone=?", [b.id, phone]);
  const active = customer
    ? await one<{ status: string }>("SELECT status FROM requests WHERE business_id=? AND customer_id=? AND status IN ('queued','sent','opened') AND created_at > datetime('now','-30 days') ORDER BY id DESC LIMIT 1", [b.id, customer.id])
    : null;
  const reviewed = customer ? await one<{ x: number }>("SELECT 1 AS x FROM requests WHERE business_id=? AND customer_id=? AND status='reviewed' LIMIT 1", [b.id, customer.id]) : null;
  return json({
    phone,
    name: customer?.name ?? "",
    opted_out: (await isOptedOut(b.id, phone)) || (await isBlocked(b.id, phone)),
    review: reviewed ? "reviewed" : active ? "asked" : "none",
    messages: rows.map((r) => ({ id: Number(r.id), direction: r.direction === "in" ? "in" : "out", body: r.body, media_urls: parseMedia(r.media_urls), created_at: r.created_at })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_messages) return fail("Customer texts are not on for this account.", 404);
  const phone = normalizePhone(decodeURIComponent((await ctx.params).phone));
  if (!isValidUsPhone(phone)) return fail("Enter a valid US phone number.");
  let text = "";
  const media: string[] = [];
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return fail("Invalid request");
    text = String(form.get("body") ?? "").trim().slice(0, 1000);
    const image = form.get("image");
    if (image instanceof File && image.size > 0) {
      const url = await storeUpload(b.id, image);
      if (!url) return fail("That image is too large or not a photo.");
      media.push(url);
    }
  } else {
    text = String((await body<{ body?: string }>(req)).body ?? "").trim().slice(0, 1000);
  }
  if (!text && media.length === 0) return fail("Message is empty.");
  const sent = await sendToCustomer(b, phone, text, 0, media);
  if (!sent.ok) {
    const why = sent.detail === "opted out" ? "This customer asked not to receive texts." : sent.detail === "do not contact" ? "This customer is on your do-not-contact list." : "Could not send. Try again in a minute.";
    return fail(why, 409);
  }
  return json({ sent: true });
}

// Name (or rename) this customer; they become a customer row if they were only a phone number.
export async function PATCH(req: Request, ctx: Ctx) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const phone = normalizePhone(decodeURIComponent((await ctx.params).phone));
  if (!isValidUsPhone(phone)) return fail("Enter a valid US phone number.");
  const name = String((await body<{ name?: string }>(req)).name ?? "").trim().slice(0, 80);
  await run(
    "INSERT INTO customers (business_id, name, phone, source) VALUES (?,?,?,'inbox') ON CONFLICT(business_id, phone) DO UPDATE SET name=excluded.name",
    [b.id, name, phone]
  );
  return json({ saved: true, name });
}
