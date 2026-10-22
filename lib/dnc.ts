// Do not contact: the business's own list of people who must never get a
// review text (bad visit, dispute, family, whatever). Different from opt_outs,
// which is the customer texting STOP and which the business can't undo.
// Keyed by phone so it holds for every source of customers, and it is checked
// twice: when a request would be queued, and again at the moment of sending.

import { all, one, run, logEvent } from "./db";
import { normalizePhone, isValidUsPhone, prettyPhone } from "./phone";

export type Blocked = { phone: string; name: string; reason: string; added_by: string; created_at: string };

export async function isBlocked(businessId: number, phone: string): Promise<boolean> {
  const r = await one("SELECT 1 AS x FROM do_not_contact WHERE business_id=? AND phone=?", [businessId, normalizePhone(phone)]);
  return Boolean(r);
}

export async function listBlocked(businessId: number): Promise<Blocked[]> {
  return all<Blocked>("SELECT phone, name, reason, added_by, created_at FROM do_not_contact WHERE business_id=? ORDER BY created_at DESC, phone", [businessId]);
}

/** Stop whatever is scheduled or mid-sequence for this phone. Returns how many requests were stopped. */
export async function cancelPending(businessId: number, phone: string, reason: string): Promise<number> {
  const r = await run(
    `UPDATE requests SET next_at='', stop_reason=?, status=CASE WHEN status='queued' THEN 'skipped' ELSE status END
     WHERE business_id=? AND next_at != '' AND customer_id IN (SELECT id FROM customers WHERE business_id=? AND phone=?)`,
    [reason, businessId, businessId, normalizePhone(phone)]
  );
  return r.changes;
}

/** Add to the list and stop anything in flight. Works for a number we've never seen, so it can be blocked ahead of time. */
export async function block(
  businessId: number,
  input: { phone: string; name?: string; reason?: string; addedBy?: "owner" | "admin" }
): Promise<{ ok: boolean; phone: string; cancelled: number }> {
  const phone = normalizePhone(input.phone);
  if (!isValidUsPhone(phone)) return { ok: false, phone, cancelled: 0 };
  const known = await one<{ name: string }>("SELECT name FROM customers WHERE business_id=? AND phone=?", [businessId, phone]);
  const name = String(input.name ?? "").trim().slice(0, 80) || known?.name || "";
  await run(
    `INSERT INTO do_not_contact (business_id, phone, name, reason, added_by) VALUES (?,?,?,?,?)
     ON CONFLICT(business_id, phone) DO UPDATE SET
       name = CASE WHEN excluded.name != '' THEN excluded.name ELSE do_not_contact.name END,
       reason = CASE WHEN excluded.reason != '' THEN excluded.reason ELSE do_not_contact.reason END`,
    [businessId, phone, name, String(input.reason ?? "").trim().slice(0, 200), input.addedBy ?? "owner"]
  );
  const cancelled = await cancelPending(businessId, phone, "do not contact");
  await logEvent(businessId, "do_not_contact", `${name || prettyPhone(phone)} added by ${input.addedBy ?? "owner"}${cancelled ? `, ${cancelled} scheduled text${cancelled === 1 ? "" : "s"} stopped` : ""}`);
  return { ok: true, phone, cancelled };
}

export async function unblock(businessId: number, phone: string, by: "owner" | "admin" = "owner") {
  const p = normalizePhone(phone);
  const r = await run("DELETE FROM do_not_contact WHERE business_id=? AND phone=?", [businessId, p]);
  if (r.changes) await logEvent(businessId, "do_not_contact", `${prettyPhone(p)} allowed again by ${by}`);
}
