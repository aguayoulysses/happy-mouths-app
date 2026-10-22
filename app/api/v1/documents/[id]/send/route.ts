// Text a receipt, invoice or quote to the customer from the business line.
// It goes through sendToCustomer, so opt-outs hold and it lands in their thread.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { one, run } from "@/lib/db";
import { normalizePhone, isValidUsPhone, prettyPhone } from "@/lib/phone";
import { sendToCustomer } from "@/lib/sms";
import { DOC_LABELS } from "@/lib/doc-labels";
import { docUrl } from "@/lib/template";

export const OPTIONS = preflight;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_invoices) return fail("Invoices are not on for this account.", 404);
  const id = Number((await ctx.params).id);
  const p = await body<{ phone?: string; name?: string }>(req);
  const phone = normalizePhone(String(p.phone ?? ""));
  if (!isValidUsPhone(phone)) return fail("Enter a valid US phone number.");
  const d = await one<{ token: string; kind: string; language: string; data: string }>("SELECT token, kind, language, data FROM documents WHERE id=? AND business_id=?", [id, b.id]);
  if (!d) return fail("Document not found.", 404);
  // The text itself is always English (his call, Sep 25 2026); the document behind the link keeps its own language.
  const label = (DOC_LABELS.en[d.kind as "receipt" | "invoice" | "quote"] ?? d.kind).toLowerCase();
  let customer = String(p.name ?? "").trim();
  if (!customer) {
    try {
      customer = String((JSON.parse(d.data) as { customer_name?: string }).customer_name ?? "");
    } catch {
      customer = "";
    }
  }
  const first = customer.split(/\s+/)[0] ?? "";
  const url = docUrl(d.token, b);
  const text = `Hi${first ? ` ${first}` : ""}, this is ${b.name}. Here is your ${label}: ${url}`;
  const sent = await sendToCustomer(b, phone, text);
  if (!sent.ok) return fail(sent.detail === "opted out" ? "This customer asked not to receive texts." : sent.detail === "do not contact" ? "This customer is on your do-not-contact list." : "Could not send. Try again in a minute.", 409);
  if (customer) await run("INSERT INTO customers (business_id, name, phone, source) VALUES (?,?,?,'invoice') ON CONFLICT(business_id, phone) DO UPDATE SET name = CASE WHEN customers.name='' THEN excluded.name ELSE customers.name END", [b.id, customer.slice(0, 80), phone]);
  return json({ sent: true, to: prettyPhone(phone) });
}
