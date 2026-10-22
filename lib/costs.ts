// Per-client finances. Every outbound text is in `messages`; Twilio posts its exact price a
// little after delivery, and the daily cron copies it onto the row. Anything not priced yet is
// estimated at list price so the numbers are never blank. Revenue is the plan on the business.

import { all, one, run } from "./db";
import { ACCOUNT_SID, PARENT_AUTH, twilioConfigured, type TwilioAuth } from "./twilio";

/** Twilio US list prices incl. typical carrier fees, per segment / per picture. */
export const EST_SMS_SEGMENT = 0.0123;
export const EST_MMS = 0.032;

function estimateSegments(body: string): number {
  const text = body.split("\n[poster]")[0];
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

/** Pull real prices from Twilio for sent messages that don't have one yet. */
export async function priceMessages(limit = 200): Promise<{ priced: number; pending: number; why?: Record<string, number> }> {
  if (!twilioConfigured()) return { priced: 0, pending: 0 };
  const rows = await all<{ id: number; business_id: number; detail: string; twilio_account_sid: string; twilio_auth_token: string }>(
    `SELECT m.id, m.business_id, m.detail, b.twilio_account_sid, b.twilio_auth_token FROM messages m JOIN businesses b ON b.id=m.business_id
     WHERE m.ok=1 AND m.priced_at='' AND (m.detail LIKE 'SM%' OR m.detail LIKE 'MM%') AND m.created_at < datetime('now','-1 hour') ORDER BY m.id LIMIT ?`,
    [limit]
  );
  let priced = 0;
  // Why a text is still unpriced, counted by reason, so a stuck job explains itself in the cron log.
  const why: Record<string, number> = {};
  const note = (k: string) => (why[k] = (why[k] ?? 0) + 1);
  for (const m of rows) {
    const own = m.twilio_account_sid && m.twilio_account_sid !== ACCOUNT_SID;
    const auth: TwilioAuth = own ? { user: m.twilio_account_sid, pass: m.twilio_auth_token } : PARENT_AUTH;
    const acct = own ? m.twilio_account_sid : ACCOUNT_SID;
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${acct}/Messages/${m.detail}.json`, {
        headers: { Authorization: "Basic " + Buffer.from(`${auth.user}:${auth.pass}`).toString("base64") },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        note(`lookup_http_${res.status}`);
        continue;
      }
      const d = (await res.json()) as { price: string | null; num_segments: string; num_media: string; status?: string; error_code?: number | null };
      if (d.price === null) {
        // Not rated yet, or never delivered: the status and carrier error code say which.
        note(`unrated_${d.status ?? "unknown"}${d.error_code ? `_${d.error_code}` : ""}`);
        continue;
      }
      await run("UPDATE messages SET price_usd=?, segments=?, media=?, priced_at=datetime('now') WHERE id=?", [
        Math.abs(Number(d.price)), Number(d.num_segments) || 1, Number(d.num_media) || 0, m.id,
      ]);
      priced++;
    } catch {
      note("network"); // next run picks it up
    }
  }
  return { priced, pending: rows.length - priced, ...(Object.keys(why).length ? { why } : {}) };
}

export type BusinessMonth = {
  id: number; name: string; status: string; plan_cents: number; fixed_cost_cents: number; setup_cost_cents: number; created_at: string;
  requests: number; texts: number; pictures: number; priced_usd: number; est_usd: number; unpriced: number;
};

/** One row per business for a given month ("YYYY-MM"). */
export async function monthByBusiness(month: string): Promise<(BusinessMonth & { messaging: number; fixed: number; setup: number; cost: number; revenue: number; margin: number })[]> {
  const rows = await all<BusinessMonth & { bodies: string }>(
    `SELECT b.id, b.name, b.status, b.plan_cents, b.fixed_cost_cents, b.setup_cost_cents, b.created_at,
       (SELECT COUNT(*) FROM requests r WHERE r.business_id=b.id AND r.step >= 1 AND strftime('%Y-%m', r.sent_at)=?) AS requests,
       (SELECT COUNT(*) FROM messages m WHERE m.business_id=b.id AND m.ok=1 AND m.media=0 AND strftime('%Y-%m', m.created_at)=?) AS texts,
       (SELECT COUNT(*) FROM messages m WHERE m.business_id=b.id AND m.ok=1 AND m.media>0 AND strftime('%Y-%m', m.created_at)=?) AS pictures,
       COALESCE((SELECT SUM(m.price_usd) FROM messages m WHERE m.business_id=b.id AND m.ok=1 AND m.priced_at!='' AND strftime('%Y-%m', m.created_at)=?), 0) AS priced_usd,
       (SELECT COUNT(*) FROM messages m WHERE m.business_id=b.id AND m.ok=1 AND m.priced_at='' AND strftime('%Y-%m', m.created_at)=?) AS unpriced,
       COALESCE((SELECT GROUP_CONCAT(m.body, char(30)) FROM messages m WHERE m.business_id=b.id AND m.ok=1 AND m.priced_at='' AND m.media=0 AND strftime('%Y-%m', m.created_at)=?), '') AS bodies,
       COALESCE((SELECT COUNT(*) FROM messages m WHERE m.business_id=b.id AND m.ok=1 AND m.priced_at='' AND m.media>0 AND strftime('%Y-%m', m.created_at)=?), 0) AS est_usd
     FROM businesses b WHERE b.demo=0 ORDER BY b.name`,
    [month, month, month, month, month, month, month]
  );
  return rows.map((r) => {
    const unpricedTexts = r.bodies ? r.bodies.split(String.fromCharCode(30)) : [];
    const est = unpricedTexts.reduce((s, body) => s + estimateSegments(body) * EST_SMS_SEGMENT, 0) + Number(r.est_usd) * EST_MMS;
    const messaging = Number(r.priced_usd) + est;
    const active = Number(r.requests) > 0 || Number(r.texts) > 0 || Number(r.pictures) > 0;
    const fixed = active || r.status === "active" ? r.fixed_cost_cents / 100 : 0;
    const setup = r.created_at.slice(0, 7) === month ? r.setup_cost_cents / 100 : 0;
    const cost = messaging + fixed + setup;
    const revenue = r.status === "active" ? r.plan_cents / 100 : 0;
    return { ...r, requests: Number(r.requests), texts: Number(r.texts), pictures: Number(r.pictures), priced_usd: Number(r.priced_usd), unpriced: Number(r.unpriced), est_usd: est, messaging, fixed, setup, cost, revenue, margin: revenue - cost };
  });
}

export async function monthsAvailable(): Promise<string[]> {
  const rows = await all<{ m: string }>("SELECT DISTINCT strftime('%Y-%m', created_at) AS m FROM messages ORDER BY m DESC");
  const now = new Date().toISOString().slice(0, 7);
  const set = new Set([now, ...rows.map((r) => r.m)]);
  return [...set];
}

export async function costSummary(businessId: number, month: string) {
  const r = (await monthByBusiness(month)).find((x) => x.id === businessId);
  const lifetime = await one<{ usd: number; n: number }>("SELECT COALESCE(SUM(price_usd),0) AS usd, COUNT(*) AS n FROM messages WHERE business_id=? AND ok=1 AND priced_at!=''", [businessId]);
  return { month: r, lifetimePriced: Number(lifetime?.usd ?? 0), lifetimeMessages: Number(lifetime?.n ?? 0) };
}
