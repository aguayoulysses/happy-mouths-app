// The customer text threads. Logging lives here so every path that sends or
// receives a text (review requests, the owner typing in the app, a missed-call
// text back, a customer writing in) ends up in the same thread.

import { all, one, run } from "./db";
import { normalizePhone } from "./phone";

export async function logConversation(o: { businessId: number; phone: string; direction: "in" | "out"; body: string; mediaUrls?: string[]; sid?: string; automated?: boolean }) {
  await run("INSERT INTO conversation_messages (business_id, customer_phone, direction, body, media_urls, message_sid, read_at, automated) VALUES (?,?,?,?,?,?,?,?)", [
    o.businessId, normalizePhone(o.phone), o.direction, o.body, JSON.stringify(o.mediaUrls ?? []), o.sid ?? "", o.direction === "out" ? new Date().toISOString() : null, o.automated ? 1 : 0,
  ]);
}

export function parseMedia(v: unknown): string[] {
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

export type Thread = { phone: string; name: string; unread: number; last_body: string; last_direction: string; last_at: string };

/**
 * Threads, newest first. With `q`, only threads that match it: `scope` "all" matches the customer
 * name, phone number or any text (the old single-list search); "contact" matches name and number only,
 * so the texts can be listed separately (see searchMessages), the way Messages on the iPhone splits
 * Conversations from Messages.
 */
export async function listThreads(businessId: number, q = "", scope: "all" | "contact" = "all"): Promise<Thread[]> {
  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const like = `%${term.replace(/[%_]/g, "")}%`;
  const byContact = `LOWER(COALESCE(cu.name,'')) LIKE ?${digits.length >= 3 ? " OR t.customer_phone LIKE ?" : ""}`;
  const byText = `OR EXISTS (SELECT 1 FROM conversation_messages s WHERE s.business_id=? AND s.automated=0 AND s.customer_phone=t.customer_phone AND LOWER(s.body) LIKE ?)`;
  const filter = term ? `WHERE ${byContact} ${scope === "all" ? byText : ""}` : "";
  const params = term ? [like, ...(digits.length >= 3 ? [`%${digits}%`] : []), ...(scope === "all" ? [businessId, like] : [])] : [];
  const rows = await all<{ customer_phone: string; unread: number; body: string; direction: string; media_urls: string; created_at: string; name: string | null }>(
    `SELECT t.customer_phone, t.unread, m.body, m.direction, m.media_urls, m.created_at, cu.name
     FROM (SELECT customer_phone, MAX(id) AS last_id, SUM(CASE WHEN direction='in' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
           FROM conversation_messages WHERE business_id=? AND automated=0 GROUP BY customer_phone) t
     JOIN conversation_messages m ON m.id = t.last_id
     LEFT JOIN customers cu ON cu.business_id=? AND cu.phone = t.customer_phone
     ${filter}
     ORDER BY t.last_id DESC LIMIT 150`,
    [businessId, businessId, ...params]
  );
  return rows.map((r) => ({
    phone: r.customer_phone,
    name: r.name ?? "",
    unread: Number(r.unread),
    last_body: r.body || (parseMedia(r.media_urls).length ? "Photo" : ""),
    last_direction: r.direction,
    last_at: r.created_at,
  }));
}

export type MessageHit = { id: number; phone: string; name: string; body: string; direction: string; created_at: string };

/**
 * Every text whose words contain `q`, newest first, one row per text (not per thread), so the owner
 * can type what they remember ("sprinkler", "Thursday", "$180") and land on that exact message.
 * Automated texts (review requests, follow-ups) are left out; they are the same words in every thread.
 */
export async function searchMessages(businessId: number, q: string, limit = 60): Promise<MessageHit[]> {
  const term = q.trim().toLowerCase().replace(/[%_]/g, "");
  if (!term) return [];
  const rows = await all<{ id: number; customer_phone: string; name: string | null; body: string; direction: string; created_at: string }>(
    `SELECT m.id, m.customer_phone, cu.name, m.body, m.direction, m.created_at
     FROM conversation_messages m
     LEFT JOIN customers cu ON cu.business_id=? AND cu.phone = m.customer_phone
     WHERE m.business_id=? AND m.automated=0 AND LOWER(m.body) LIKE ?
     ORDER BY m.id DESC LIMIT ?`,
    [businessId, businessId, `%${term}%`, limit]
  );
  return rows.map((r) => ({ id: Number(r.id), phone: r.customer_phone, name: r.name ?? "", body: r.body, direction: r.direction, created_at: r.created_at }));
}

export async function unreadCount(businessId: number): Promise<number> {
  const r = await one<{ n: number }>("SELECT COUNT(*) AS n FROM conversation_messages WHERE business_id=? AND direction='in' AND read_at IS NULL", [businessId]);
  return Number(r?.n ?? 0);
}
