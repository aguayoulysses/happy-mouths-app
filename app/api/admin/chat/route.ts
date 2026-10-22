// The ops chat feed. GET returns every live client's thread summary plus, for one business,
// its messages (optionally only those after an id, for polling). POST sends a reply as the
// client's account manager and pushes it to their phone. DELETE removes one message.

import { one, run } from "@/lib/db";
import { currentOps, isAdmin, type Business } from "@/lib/auth";
import { assignThread, clientIMessagePhone, kickDrain, queueText } from "@/lib/imessage";
import { isValidUsPhone, normalizePhone } from "@/lib/phone";
import { json, fail } from "@/lib/api";
import { pushToBusiness } from "@/lib/push";
import { repFor } from "@/lib/reps";
import { threads, thread, markRead, type ChatMessage } from "@/lib/team-chat";

export async function GET(req: Request) {
  if (!(await isAdmin())) return fail("Unauthorized", 401);
  const u = new URL(req.url);
  const business = Number(u.searchParams.get("business") ?? 0);
  const after = Number(u.searchParams.get("after") ?? 0);
  const messages = business ? await thread(business, after) : [];
  if (business && messages.some((m) => m.sender === "client" && !m.read_at)) await markRead(business);
  return json({ threads: await threads(), messages });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return fail("Unauthorized", 401);
  const { business, body, channel } = (await req.json().catch(() => ({}))) as { business?: number; body?: string; channel?: string };
  const id = Number(business ?? 0);
  const text = String(body ?? "").trim().slice(0, 2000);
  const b = await one<Business>("SELECT * FROM businesses WHERE id=?", [id]);
  if (!b || !text) return fail("Nothing to send.");
  if (channel === "imessage") {
    // Over our iMessage line. The text lands in this thread once it has gone out (lib/imessage.ts mirrors it).
    const me = await currentOps();
    const phone = await clientIMessagePhone(id);
    if (!phone) return fail("This client has no phone for iMessage.");
    const r = await queueText({ phone, body: text, repKey: me?.key ?? b.rep_key });
    if (!r.ok) return fail(r.detail);
    await markRead(id);
    kickDrain();
    return json({ queued: true, threads: await threads() });
  }
  await run("INSERT INTO team_messages (business_id, sender, body) VALUES (?,?,?)", [id, "team", text]);
  await markRead(id);
  await pushToBusiness(id, { title: repFor(b.rep_key).name, body: text.slice(0, 160), data: { kind: "team" }, threadId: "team" });
  const sent = await one<ChatMessage>("SELECT id, business_id, sender, body, image_url, read_at, created_at, channel FROM team_messages WHERE business_id=? ORDER BY id DESC LIMIT 1", [id]);
  return json({ message: sent, threads: await threads() });
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) return fail("Unauthorized", 401);
  const { id } = (await req.json().catch(() => ({}))) as { id?: number };
  if (!id) return fail("Which message?");
  await run("DELETE FROM team_messages WHERE id=?", [Number(id)]);
  return json({ deleted: Number(id), threads: await threads() });
}

/** Sets the number a client's iMessages go to (their cell, when the account has none on file). */
export async function PATCH(req: Request) {
  const me = await currentOps();
  if (!me) return fail("Unauthorized", 401);
  const { business, phone } = (await req.json().catch(() => ({}))) as { business?: number; phone?: string };
  const id = Number(business ?? 0);
  const e164 = normalizePhone(String(phone ?? ""));
  if (!id || !(await one("SELECT 1 AS x FROM businesses WHERE id=?", [id]))) return fail("Which client?");
  if (!isValidUsPhone(e164)) return fail("That phone number looks off. Use a 10-digit number.");
  await assignThread(e164, { kind: "client", businessId: id }, me.key);
  return json({ phone: e164 });
}
