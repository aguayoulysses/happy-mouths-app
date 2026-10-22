// The "Ask for a review" button in a thread: puts this customer on the
// business's review sequence right now, same path as Add customer.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { normalizePhone } from "@/lib/phone";
import { addCustomerAndQueue, deliverRequest } from "@/lib/requests";

export const OPTIONS = preflight;

const WHY: Record<string, string> = {
  already_active: "They already have a review request from the last 30 days.",
  already_reviewed: "They already left you a Google review.",
  opted_out: "This customer asked not to receive texts.",
  do_not_contact: "This customer is on your do-not-contact list.",
  invalid_phone: "That is not a valid US phone number.",
};

export async function POST(req: Request, ctx: { params: Promise<{ phone: string }> }) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const phone = normalizePhone(decodeURIComponent((await ctx.params).phone));
  const p = await body<{ name?: string }>(req);
  const r = await addCustomerAndQueue(b, { name: String(p.name ?? ""), phone, source: "inbox", sendNow: true });
  if (r.outcome !== "queued" || !r.request) return fail(WHY[r.outcome] ?? "Could not send the request.", 409);
  const sent = await deliverRequest(b, r.request.id);
  return json({ asked: true, status: sent?.status ?? "queued" });
}
