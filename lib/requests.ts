// The review request pipeline. A customer is added → a request is queued for
// now + delay → the cron sends it → the customer taps the link (we record the
// tap and send them to Google) → the hourly review sync marks it "reviewed"
// when a matching Google review shows up.

import { randomBytes } from "node:crypto";
import { all, one, run, logEvent } from "./db";
import type { Business } from "./auth";
import { normalizePhone, isValidUsPhone } from "./phone";
import { sendToCustomer, isOptedOut } from "./sms";
import { renderTemplate, gateUrl } from "./template";
import { generatePoster } from "./poster";
import { getSteps } from "./sequence";
import { isBlocked } from "./dnc";
import { namesMatch, firstNameOnly } from "./names";

export type Customer = { id: number; business_id: number; name: string; phone: string; email: string; source: string; created_at: string };
export type ReviewRequest = {
  id: number;
  business_id: number;
  customer_id: number;
  code: string;
  status: "queued" | "sent" | "opened" | "reviewed" | "failed" | "skipped";
  send_at: string;
  sent_at: string;
  opened_at: string;
  rated_at: string;
  stars: number;
  reviewed_at: string;
  message_sid: string;
  poster_url: string;
  step: number;
  next_at: string;
  stop_reason: string;
  error: string;
  created_at: string;
};

export const GOOD = 4; // this many stars or more on the gate goes to Google

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function shortCode(len = 7): string {
  const bytes = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Does Google already hold a review from this customer? Checked before the first text, because
 * a list of long-time customers is full of people who reviewed the business years ago.
 *  - sure: an earlier request of theirs ended in a review, or first name and last name both fit a
 *    reviewer. They are never texted.
 *  - not sure: only a first name on file, and it fits exactly one reviewer. They are asked once and
 *    never followed up. With many reviews a common first name fits several people and proves nothing,
 *    so those customers get the normal sequence.
 */
export async function pastReview(businessId: number, customerId: number, name: string): Promise<{ sure: boolean; as: string } | null> {
  const mine = await one<{ reviewer_name: string | null }>(
    `SELECT v.reviewer_name FROM requests r LEFT JOIN reviews v ON v.request_id = r.id
     WHERE r.business_id=? AND r.customer_id=? AND r.status='reviewed' ORDER BY r.id DESC LIMIT 1`,
    [businessId, customerId]
  );
  if (mine) return { sure: true, as: mine.reviewer_name || name };
  if (!name.trim()) return null;
  const reviewers = await all<{ reviewer_name: string }>(
    "SELECT reviewer_name FROM reviews WHERE business_id=? AND reviewer_name != '' AND review_name NOT LIKE 'accounts/demo/%'",
    [businessId]
  );
  const fits = reviewers.filter((v) => namesMatch(name, v.reviewer_name));
  if (!fits.length) return null;
  if (!firstNameOnly(name)) return { sure: true, as: fits[0].reviewer_name };
  return fits.length === 1 ? { sure: false, as: fits[0].reviewer_name } : null;
}

/**
 * Upsert a customer and queue one request unless one is already in flight.
 * Returns the customer plus what happened, so callers (Quick Add, CSV import,
 * webhooks) can report it without re-querying.
 */
export async function addCustomerAndQueue(
  b: Business,
  input: { name: string; phone: string; email?: string; source?: string; sendNow?: boolean; sendAt?: string }
): Promise<{ customer: Customer; request: ReviewRequest | null; outcome: "queued" | "already_active" | "already_reviewed" | "opted_out" | "do_not_contact" | "invalid_phone" }> {
  const phone = normalizePhone(input.phone);
  if (!isValidUsPhone(phone)) {
    return { customer: { id: 0, business_id: b.id, name: input.name, phone, email: "", source: "", created_at: "" }, request: null, outcome: "invalid_phone" };
  }
  const name = String(input.name ?? "").trim().slice(0, 80);
  await run(
    `INSERT INTO customers (business_id, name, phone, email, source) VALUES (?,?,?,?,?)
     ON CONFLICT(business_id, phone) DO UPDATE SET
       name = CASE WHEN excluded.name != '' THEN excluded.name ELSE customers.name END,
       email = CASE WHEN excluded.email != '' THEN excluded.email ELSE customers.email END`,
    [b.id, name, phone, String(input.email ?? "").trim(), input.source ?? "manual"]
  );
  const customer = (await one<Customer>("SELECT * FROM customers WHERE business_id=? AND phone=?", [b.id, phone]))!;

  if (await isOptedOut(b.id, phone)) return { customer, request: null, outcome: "opted_out" };
  if (await isBlocked(b.id, phone)) {
    await logEvent(b.id, "blocked", `${customer.name || phone} via ${input.source ?? "manual"}: on the do-not-contact list, nothing queued`);
    return { customer, request: null, outcome: "do_not_contact" };
  }

  // One live request per customer: no double-texting someone who was just added twice.
  const active = await one<ReviewRequest>(
    `SELECT * FROM requests WHERE business_id=? AND customer_id=? AND status IN ('queued','sent','opened')
     AND created_at > datetime('now','-30 days') ORDER BY id DESC LIMIT 1`,
    [b.id, customer.id]
  );
  if (active) return { customer, request: active, outcome: "already_active" };

  const past = await pastReview(b.id, customer.id, customer.name);
  if (past?.sure) {
    await logEvent(b.id, "already_reviewed", `${customer.name || phone} via ${input.source ?? "manual"}: already reviewed on Google as "${past.as}", nothing queued`);
    return { customer, request: null, outcome: "already_reviewed" };
  }

  const steps = await getSteps(b.id);
  const delay = input.sendNow ? 0 : Math.max(0, steps[0]?.delay_minutes ?? Number(b.delay_minutes) ?? 0);
  // A fixed time (UTC, SQLite format) wins: the reactivation list hands out its own daily slots.
  const sendAt = input.sendAt || sqlTime(new Date(Date.now() + delay * 60_000));
  const code = shortCode();
  const { lastId } = await run("INSERT INTO requests (business_id, customer_id, code, status, send_at, next_at) VALUES (?,?,?,?,?,?)", [
    b.id,
    customer.id,
    code,
    "queued",
    sendAt,
    sendAt,
  ]);
  const request = (await one<ReviewRequest>("SELECT * FROM requests WHERE id=?", [lastId]))!;
  await logEvent(b.id, "queued", `${customer.name || phone} via ${input.source ?? "manual"}${input.sendAt ? ` for ${input.sendAt} UTC` : delay ? ` in ${delay} min` : " now"}`);
  return { customer, request, outcome: "queued" };
}

/** Pull the queued request forward to right now (the "Send now" button). */
export async function sendNow(b: Business, customerId: number): Promise<ReviewRequest | null> {
  const r = await one<ReviewRequest>(
    "SELECT * FROM requests WHERE business_id=? AND customer_id=? AND next_at != '' AND status IN ('queued','sent','opened') ORDER BY id DESC LIMIT 1",
    [b.id, customerId]
  );
  if (r) {
    await run("UPDATE requests SET next_at=datetime('now'), send_at=CASE WHEN step=0 THEN datetime('now') ELSE send_at END WHERE id=?", [r.id]);
    return deliverRequest(b, r.id);
  }
  const customer = await one<Customer>("SELECT * FROM customers WHERE id=? AND business_id=?", [customerId, b.id]);
  if (!customer) return null;
  const res = await addCustomerAndQueue(b, { name: customer.name, phone: customer.phone, source: customer.source, sendNow: true });
  if (res.outcome !== "queued" || !res.request) return res.request;
  return deliverRequest(b, res.request.id);
}

/** Stop a sequence for good (review seen, STOP, removed). */
export async function stopRequest(requestId: number, reason: string, status?: ReviewRequest["status"]) {
  await run(
    `UPDATE requests SET next_at='', stop_reason=?, status=COALESCE(?, status) WHERE id=? AND next_at != ''`,
    [reason, status ?? null, requestId]
  );
}

/**
 * Send the next step of one request. Idempotent: nothing due means nothing
 * sent. Step 1 flips queued → sent; later steps keep the status and just
 * advance `step` and `next_at`.
 */
export async function deliverRequest(b: Business, requestId: number): Promise<ReviewRequest | null> {
  const r = await one<ReviewRequest & { name: string; phone: string }>(
    `SELECT r.*, c.name, c.phone FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.id=? AND r.business_id=?`,
    [requestId, b.id]
  );
  if (!r || r.next_at === "" || !["queued", "sent", "opened"].includes(r.status)) return r;
  // Last check before a follow-up leaves: someone who rated us well on the gate went to Google and is
  // done being asked, however the request got here (rated before the gate stopped sequences, a restore).
  if (r.step > 0 && r.stars >= GOOD) {
    await stopRequest(r.id, `rated ${r.stars} stars, sent to Google`);
    await logEvent(b.id, "rated", `${r.name || r.phone} already rated ${r.stars} stars. Follow-ups stopped.`);
    return one<ReviewRequest>("SELECT * FROM requests WHERE id=?", [r.id]);
  }
  const steps = await getSteps(b.id);
  const step = steps[r.step];
  if (!step) {
    await stopRequest(r.id, "sequence finished");
    return one<ReviewRequest>("SELECT * FROM requests WHERE id=?", [r.id]);
  }
  if (!b.review_link) {
    await run("UPDATE requests SET status='failed', next_at='', error=? WHERE id=?", ["no Google review link on the account", r.id]);
    return one<ReviewRequest>("SELECT * FROM requests WHERE id=?", [r.id]);
  }
  if (b.status === "paused" || b.status === "cancelled") {
    await run("UPDATE requests SET status='skipped', next_at='', error=? WHERE id=?", [`account ${b.status}`, r.id]);
    return one<ReviewRequest>("SELECT * FROM requests WHERE id=?", [r.id]);
  }
  // Plan limit counts customers we started on this month, not follow-ups. Held, not failed.
  if (r.step === 0 && b.monthly_limit > 0) {
    const used = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM requests WHERE business_id=? AND step >= 1 AND strftime('%Y-%m', sent_at) = strftime('%Y-%m', 'now')",
      [b.id]
    );
    if (Number(used?.n ?? 0) >= b.monthly_limit) {
      await run("UPDATE requests SET error='monthly limit reached, waiting' WHERE id=?", [r.id]);
      return one<ReviewRequest>("SELECT * FROM requests WHERE id=?", [r.id]);
    }
  }
  // A review can land between queueing and sending, so the first text checks Google's list again.
  const past = r.step === 0 ? await pastReview(b.id, r.customer_id, r.name) : null;
  if (past?.sure) {
    await run("UPDATE requests SET status='skipped', next_at='', stop_reason=? WHERE id=?", [`already reviewed as ${past.as}`, r.id]);
    await logEvent(b.id, "already_reviewed", `${r.name || r.phone}: already reviewed on Google as "${past.as}", nothing sent`);
    return one<ReviewRequest>("SELECT * FROM requests WHERE id=?", [r.id]);
  }
  // The customer sees the real Google link unless this business is set to tracked links.
  const link = b.track_links || b.gate_enabled ? gateUrl(r.code, b) : b.review_link;
  const text = renderTemplate(step.body, { name: r.name, business: b.name, link });
  // Each step can carry its own picture (the sign first, a meme on a follow-up). Step 1 defaults to the business's sign photo.
  const posterKey = step.poster_template || (r.step === 0 ? b.poster_template : r.step === 1 ? b.meme_template : "");
  const poster = await generatePoster(b, r.name, link, r.code, posterKey, r.step === 0);
  if (poster) await run("UPDATE requests SET poster_url=? WHERE id=?", [poster, r.id]);
  // Two messages on purpose. The words and the link go as a plain text, which every phone can
  // receive and which carriers confirm. The sign photo follows on its own: a phone that can't
  // take picture messages drops only the picture, never the request. Carriers give no receipt
  // for pictures, so a lost one can't be detected; this way it can't cost us the review either.
  const res = await sendToCustomer(b, r.phone, text, r.id);
  if (res.ok && poster) {
    const pic = await sendToCustomer(b, r.phone, "", r.id, [poster]);
    if (!pic.ok) await logEvent(b.id, "poster_failed", `${r.name || r.phone}: ${pic.detail.slice(0, 120)}`);
  }
  if (res.ok) {
    // Someone who may have reviewed before is asked once. A reminder about a review they wrote last year is the text we never want.
    const maybe = past;
    const nextStep = maybe ? undefined : steps[r.step + 1];
    const nextAt = nextStep ? sqlTime(new Date(Date.now() + nextStep.delay_minutes * 60_000)) : "";
    const done = maybe ? `asked once, may have reviewed as ${maybe.as}` : "sequence finished";
    await run(
      `UPDATE requests SET step=step+1, next_at=?, stop_reason=CASE WHEN ?='' THEN ? ELSE stop_reason END,
         status=CASE WHEN status='queued' THEN 'sent' ELSE status END,
         sent_at=CASE WHEN sent_at='' THEN datetime('now') ELSE sent_at END, message_sid=?, error='' WHERE id=?`,
      [nextAt, nextAt, done, res.detail, r.id]
    );
    await logEvent(b.id, "sent", `${r.name || r.phone}: step ${r.step + 1} of ${maybe ? 1 : steps.length}${maybe ? ` (one ask only, may have reviewed as "${maybe.as}")` : ""}`);
  } else if (res.detail === "opted out" || res.detail === "do not contact") {
    await run("UPDATE requests SET status=CASE WHEN step=0 THEN 'skipped' ELSE status END, next_at='', stop_reason=?, error=? WHERE id=?", [res.detail, res.detail, r.id]);
  } else {
    await run("UPDATE requests SET status=CASE WHEN step=0 THEN 'failed' ELSE status END, error=? WHERE id=?", [res.detail.slice(0, 300), r.id]);
    await logEvent(b.id, "failed", `${r.name || r.phone}: ${res.detail.slice(0, 120)}`);
  }
  return one<ReviewRequest>("SELECT * FROM requests WHERE id=?", [r.id]);
}

/** Cron: everything due, oldest first, across all businesses. */
export async function sendDueRequests(limit = 100): Promise<{ sent: number; failed: number; skipped: number }> {
  // Anyone who rated us well and still has a follow-up on the calendar comes off it now, not on the day it is due.
  await run(
    `UPDATE requests SET next_at='', stop_reason='rated ' || stars || ' stars, sent to Google'
     WHERE next_at != '' AND step > 0 AND stars >= ? AND status IN ('sent','opened')`,
    [GOOD]
  );
  const due = await all<{ id: number; business_id: number; step: number }>(
    "SELECT id, business_id, step FROM requests WHERE next_at != '' AND next_at <= datetime('now') AND status IN ('queued','sent','opened') ORDER BY next_at LIMIT ?",
    [limit]
  );
  const out = { sent: 0, failed: 0, skipped: 0 };
  const cache = new Map<number, Business | null>();
  for (const d of due) {
    if (!cache.has(d.business_id)) cache.set(d.business_id, await one<Business>("SELECT * FROM businesses WHERE id=?", [d.business_id]));
    const b = cache.get(d.business_id);
    if (!b) continue;
    const r = await deliverRequest(b, d.id);
    if (r?.error === "" && r?.status !== "failed" && r.step > d.step) out.sent++;
    else if (r?.status === "skipped" || r?.status === "queued" || (r?.error === "" && r?.next_at === "")) out.skipped++;
    else out.failed++;
  }
  return out;
}

const TAPBACK = /^(liked|loved|laughed at|emphasized|disliked|questioned|reacted)\b/i;
const REVIEW_WORD = /\b(reviews?|rese[ñn]as?|stars?|estrellas?)\b/i;
const DID_IT = /\b(already|left|gave|did|done|wrote|written|posted|submitted|sent|just|ya|dej[eé]|hice|puse|di|listo|hecho)\b/i;
const NOT_YET = /\b(how|can'?t|cannot|couldn'?t|could not|won'?t|will not|unable|not able|didn'?t|did not|haven'?t|have not|not yet|later|tomorrow|tonight|c[oó]mo|no puedo|no pude|despu[eé]s|ma[ñn]ana|todav[ií]a)\b|\?\s*$/i;
const DONE_OPENER = /^(done|did it|all done|i did|ya lo hice|ya la hice|listo|hecho)\b/i;

/**
 * Does this reply say the review is already written? Built to lean toward yes: a wrong yes costs one
 * skipped follow-up, a wrong no sends "we're not okay over here" to someone who already helped.
 */
export function saysReviewed(text: string): boolean {
  const t = text.trim();
  if (!t || TAPBACK.test(t)) return false; // a tapback quotes our own text, review link and all
  // Judge the first sentence on its own, so "Did it the day you asked. Have you checked the site?" still counts.
  const lead = t.split(/(?<=[.!?])\s+/)[0];
  if (DONE_OPENER.test(lead)) return true;
  return [lead, t].some((s) => REVIEW_WORD.test(s) && DID_IT.test(s) && !NOT_YET.test(s));
}

/** A customer texted back that they already reviewed: end their follow-ups. Returns how many were stopped. */
export async function stopOnReviewedReply(businessId: number, phone: string, text: string): Promise<number> {
  if (!saysReviewed(text)) return 0;
  const live = await all<{ id: number }>(
    `SELECT r.id FROM requests r JOIN customers c ON c.id=r.customer_id
     WHERE r.business_id=? AND c.phone=? AND r.next_at != '' AND r.step > 0 AND r.status IN ('sent','opened')`,
    [businessId, phone]
  );
  for (const r of live) await stopRequest(r.id, "said they already reviewed");
  return live.length;
}

/** Called by the gate page: first open flips sent → opened. */
export async function markOpened(code: string) {
  await run("UPDATE requests SET status='opened', opened_at=datetime('now') WHERE code=? AND status='sent'", [code]);
}

export function statusLabel(s: ReviewRequest["status"]): string {
  return {
    queued: "Scheduled",
    sent: "Sent",
    opened: "Tapped the link",
    reviewed: "Reviewed",
    failed: "Failed",
    skipped: "Skipped",
  }[s];
}
