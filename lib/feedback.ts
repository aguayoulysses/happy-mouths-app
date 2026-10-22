// The review gate. The link in the text asks for stars first. 4 and 5 go on to
// Google; 1 to 3 stop the follow-up texts on the spot and open a private note to
// the owner instead. Every step is safe to repeat: a customer who taps twice or
// reloads never triggers a second alert.

import { one, run, logEvent } from "./db";
import type { Business } from "./auth";
import { normalizePhone, isValidUsPhone, prettyPhone } from "./phone";
import { pushToBusiness } from "./push";
import { lane } from "./sms";
import { sendSms, twilioConfigured } from "./twilio";
import { firstName } from "./template";
import { stopRequest, GOOD } from "./requests";

export type GateRow = {
  id: number;
  business_id: number;
  customer_id: number;
  status: string;
  stars: number;
  next_at: string;
  customer_name: string;
  customer_phone: string;
};

export { GOOD };

export async function loadGate(code: string): Promise<{ r: GateRow; b: Business } | null> {
  const r = await one<GateRow>(
    `SELECT r.id, r.business_id, r.customer_id, r.status, r.stars, r.next_at, c.name AS customer_name, c.phone AS customer_phone
     FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.code=?`,
    [code]
  );
  if (!r) return null;
  const b = await one<Business>("SELECT * FROM businesses WHERE id=?", [r.business_id]);
  if (!b) return null;
  return { r, b };
}

/** Where the business hears about a bad rating: the lead alert numbers, else the owner's cell. */
function alertNumbers(b: Business): string[] {
  const list = (b.lead_alert_phones || b.owner_phone || "").split(",").map((p) => normalizePhone(p)).filter(isValidUsPhone);
  return Array.from(new Set(list));
}

async function alertOwner(b: Business, body: string) {
  if (b.demo) return;
  const l = lane(b);
  if (!l || !twilioConfigured()) return;
  await Promise.all(alertNumbers(b).map(async (to) => {
    const res = await sendSms({ ...l, to, body }).then((m) => ({ ok: 1, detail: m.sid })).catch((err) => ({ ok: 0, detail: err instanceof Error ? err.message : String(err) }));
    await run("INSERT INTO messages (business_id, lane, to_phone, body, ok, detail) VALUES (?,?,?,?,?,?)", [b.id, "feedback-alert", to, body, res.ok, res.detail.slice(0, 300)]);
  }));
}

/**
 * Record the stars. The first time a customer lands below GOOD, the follow-up
 * texts stop, a feedback row opens, and the owner gets a text and a push.
 */
export async function rateRequest(r: GateRow, b: Business, stars: number): Promise<void> {
  const s = Math.min(5, Math.max(1, Math.round(stars)));
  await run(
    `UPDATE requests SET stars=?, rated_at=CASE WHEN rated_at='' THEN datetime('now') ELSE rated_at END,
       status=CASE WHEN status='sent' THEN 'opened' ELSE status END, opened_at=CASE WHEN opened_at='' THEN datetime('now') ELSE opened_at END WHERE id=?`,
    [s, r.id]
  );
  const who = r.customer_name || prettyPhone(r.customer_phone);
  if (s >= GOOD) {
    // They were just sent to Google. Whatever their Google account is called, the asking is over:
    // a "we're not okay" follow-up three days after someone reviewed is the one text we never want.
    // The request stays 'opened' so the hourly sync can still mark it reviewed.
    if (r.next_at) {
      await stopRequest(r.id, `rated ${s} stars, sent to Google`);
      await logEvent(b.id, "rated", `${who} rated ${s} stars and went to Google. Follow-ups stopped.`);
    }
    return;
  }

  await stopRequest(r.id, `rated ${s} stars, kept private`);
  const existing = await one<{ id: number }>("SELECT id FROM feedback WHERE request_id=?", [r.id]);
  if (existing) {
    await run("UPDATE feedback SET stars=? WHERE id=?", [s, existing.id]);
    return;
  }
  await run(
    "INSERT INTO feedback (business_id, request_id, customer_id, stars, name, phone, comment, contact_ok) VALUES (?,?,?,?,?,?,'',1)",
    [b.id, r.id, r.customer_id, s, r.customer_name, r.customer_phone]
  );
  await logEvent(b.id, "feedback", `${who} rated ${s} star${s === 1 ? "" : "s"} privately. Follow-ups stopped.`);
  await pushToBusiness(b.id, { title: `${who} left ${s} star${s === 1 ? "" : "s"}`, body: "Kept private, not on Google. Worth a call today.", data: { kind: "customers" }, threadId: "feedback" });
  await alertOwner(b, `${who} rated ${b.name} ${s} star${s === 1 ? "" : "s"} privately (not on Google). Their number: ${prettyPhone(r.customer_phone)}. If they add a note you'll get it here. Follow-up texts to them are stopped.`);
}

/** The private note. Only the first non-empty comment sends an alert. */
export async function saveComment(r: GateRow, b: Business, input: { comment: string; contactOk: boolean }): Promise<void> {
  const comment = input.comment.trim().slice(0, 1500);
  const who = r.customer_name || prettyPhone(r.customer_phone);
  const existing = await one<{ id: number; comment: string }>("SELECT id, comment FROM feedback WHERE request_id=?", [r.id]);
  if (!existing) {
    // Someone posted the form without going through the stars (or the row is gone). Treat it as the lowest bad rating on record.
    const stars = r.stars && r.stars < GOOD ? r.stars : 3;
    await rateRequest(r, b, stars);
  }
  const row = existing ?? (await one<{ id: number; comment: string }>("SELECT id, comment FROM feedback WHERE request_id=?", [r.id]));
  if (!row) return;
  await run("UPDATE feedback SET comment=CASE WHEN ?='' THEN comment ELSE ? END, contact_ok=? WHERE id=?", [comment, comment, input.contactOk ? 1 : 0, row.id]);
  if (!comment || row.comment) return;
  const first = firstName(r.customer_name) || "They";
  await logEvent(b.id, "feedback", `${who}: "${comment.slice(0, 200)}"`);
  await pushToBusiness(b.id, { title: `${first} wrote a note`, body: comment.slice(0, 160), data: { kind: "customers" }, threadId: "feedback" });
  await alertOwner(b, `${who} wrote: "${comment.slice(0, 600)}"${input.contactOk ? "" : " (asked not to be contacted about it)"}`);
}
