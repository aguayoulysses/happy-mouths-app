// The ops iMessage inbox feed. GET: thread list plus one thread's texts (only those after an id,
// for polling). POST: send a text now. DELETE: cancel a queued text.

import { currentOps } from "@/lib/auth";
import { json, fail } from "@/lib/api";
import { cancelQueued, kickDrain, listTextThreads, markTextsRead, queueText, setContactName, textThread } from "@/lib/imessage";

export async function GET(req: Request) {
  if (!(await currentOps())) return fail("Unauthorized", 401);
  const u = new URL(req.url);
  const phone = u.searchParams.get("phone") ?? "";
  const after = Number(u.searchParams.get("after") ?? 0);
  const texts = phone ? await textThread(phone, after) : [];
  if (phone && texts.some((m) => m.direction === "in" && !m.read_at)) await markTextsRead(phone);
  if (u.searchParams.get("only") === "1") return json({ texts });
  return json({ threads: await listTextThreads(u.searchParams.get("q") ?? ""), texts });
}

export async function POST(req: Request) {
  const me = await currentOps();
  if (!me) return fail("Unauthorized", 401);
  const { phone, body, name } = (await req.json().catch(() => ({}))) as { phone?: string; body?: string; name?: string };
  if (name?.trim() && phone) await setContactName(String(phone), name);
  const r = await queueText({ phone: String(phone ?? ""), body: String(body ?? ""), repKey: me.key });
  if (!r.ok) return fail(r.detail);
  await markTextsRead(String(phone));
  kickDrain();
  return json({ ok: true, id: r.id });
}

export async function DELETE(req: Request) {
  if (!(await currentOps())) return fail("Unauthorized", 401);
  const { id } = (await req.json().catch(() => ({}))) as { id?: number };
  if (!id) return fail("Which text?");
  await cancelQueued(Number(id));
  return json({ ok: true });
}

/** Name the person behind a number (a lead's name is saved on their deal). */
export async function PATCH(req: Request) {
  if (!(await currentOps())) return fail("Unauthorized", 401);
  const { phone, name } = (await req.json().catch(() => ({}))) as { phone?: string; name?: string };
  if (!phone) return fail("Which number?");
  await setContactName(String(phone), String(name ?? ""));
  return json({ ok: true, threads: await listTextThreads() });
}
