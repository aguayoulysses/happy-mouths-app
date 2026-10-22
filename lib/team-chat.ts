// The ops side of team chat: thread summaries for the inbox, one client's messages, and marking read.
import { all, run } from "./db";
import { markClientTextsRead } from "./imessage";

export type ChatMessage = { id: number; business_id: number; sender: string; body: string; image_url: string; read_at: string | null; created_at: string; channel: string };
export type ChatThread = { id: number; name: string; owner_name: string; rep_key: string; logo_url: string; unread: number; last_body: string; last_sender: string; last_at: string };

export async function threads(): Promise<ChatThread[]> {
  const rows = await all<ChatThread>(
    `SELECT b.id, b.name, b.owner_name, b.rep_key, b.logo_url,
       (SELECT COUNT(*) FROM team_messages t WHERE t.business_id=b.id AND t.sender='client' AND t.read_at IS NULL) AS unread,
       COALESCE((SELECT t.body FROM team_messages t WHERE t.business_id=b.id ORDER BY t.id DESC LIMIT 1), '') AS last_body,
       COALESCE((SELECT t.sender FROM team_messages t WHERE t.business_id=b.id ORDER BY t.id DESC LIMIT 1), '') AS last_sender,
       COALESCE((SELECT t.created_at FROM team_messages t WHERE t.business_id=b.id ORDER BY t.id DESC LIMIT 1), '') AS last_at
     FROM businesses b WHERE b.demo=0 AND b.status IN ('active','trial')
     ORDER BY unread DESC, last_at DESC, b.name`
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), unread: Number(r.unread) }));
}

export async function thread(businessId: number, afterId = 0): Promise<ChatMessage[]> {
  const rows = afterId
    ? await all<ChatMessage>("SELECT id, business_id, sender, body, image_url, read_at, created_at, channel FROM team_messages WHERE business_id=? AND id>? ORDER BY id ASC", [businessId, afterId])
    : await all<ChatMessage>("SELECT id, business_id, sender, body, image_url, read_at, created_at, channel FROM (SELECT * FROM team_messages WHERE business_id=? ORDER BY id DESC LIMIT 200) ORDER BY id ASC", [businessId]);
  return rows.map((r) => ({ ...r, id: Number(r.id), business_id: Number(r.business_id) }));
}

export async function markRead(businessId: number) {
  await run("UPDATE team_messages SET read_at=datetime('now') WHERE business_id=? AND sender='client' AND read_at IS NULL", [businessId]);
  await markClientTextsRead(businessId);
}

