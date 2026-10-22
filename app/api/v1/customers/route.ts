import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all } from "@/lib/db";
import { addCustomerAndQueue, deliverRequest } from "@/lib/requests";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const rows = await all(
    `SELECT c.id, c.name, c.phone, c.email, c.source, c.created_at,
            (SELECT status FROM requests r WHERE r.customer_id=c.id ORDER BY r.id DESC LIMIT 1) AS last_status,
            (SELECT send_at FROM requests r WHERE r.customer_id=c.id ORDER BY r.id DESC LIMIT 1) AS last_send_at,
            (SELECT COUNT(*) FROM requests r WHERE r.customer_id=c.id AND r.status != 'queued') AS requests_sent,
            (SELECT next_at FROM requests r WHERE r.customer_id=c.id ORDER BY r.id DESC LIMIT 1) AS last_next_at,
            (SELECT stars FROM requests r WHERE r.customer_id=c.id ORDER BY r.id DESC LIMIT 1) AS last_stars,
            (SELECT comment FROM feedback f WHERE f.customer_id=c.id ORDER BY f.id DESC LIMIT 1) AS feedback,
            EXISTS(SELECT 1 FROM opt_outs o WHERE o.business_id=c.business_id AND o.phone=c.phone) AS opted_out,
            EXISTS(SELECT 1 FROM do_not_contact d WHERE d.business_id=c.business_id AND d.phone=c.phone) AS blocked
     FROM customers c WHERE c.business_id=? AND c.source != 'test' AND NOT EXISTS(SELECT 1 FROM requests t WHERE t.customer_id=c.id AND t.stop_reason='test finished') ${q ? "AND (c.name LIKE ? OR c.phone LIKE ?)" : ""}
     ORDER BY c.id DESC LIMIT 500`,
    q ? [b.id, `%${q}%`, `%${q.replace(/\D/g, "")}%`] : [b.id]
  );
  return json({ customers: rows });
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const input = await body<{ name?: string; phone?: string; email?: string; send_now?: boolean }>(req);
  if (!input.phone) return fail("Phone number required");
  const r = await addCustomerAndQueue(b, { name: input.name ?? "", phone: input.phone, email: input.email, source: "manual", sendNow: Boolean(input.send_now) });
  if (r.outcome === "invalid_phone") return fail("That phone number doesn't look like a US mobile number");
  if (r.outcome === "opted_out") return fail("This customer texted STOP, so we can't message them", 409);
  if (r.outcome === "do_not_contact") return fail("They're on your do-not-contact list, so nothing was scheduled", 409);
  if (r.outcome === "already_reviewed") return fail("They already left you a Google review, so nothing was scheduled", 409);
  let request = r.request;
  if (input.send_now && r.outcome === "queued" && request) request = await deliverRequest(b, request.id);
  return json({ customer: r.customer, request, outcome: r.outcome }, 201);
}
