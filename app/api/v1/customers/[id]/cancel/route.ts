// "Don't send this one": stops the scheduled text (and any follow-ups) for one
// customer without putting them on the do-not-contact list.

import { json, fail, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { one, logEvent } from "@/lib/db";
import { cancelPending } from "@/lib/dnc";

export const OPTIONS = preflight;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { id } = await ctx.params;
  const c = await one<{ name: string; phone: string }>("SELECT name, phone FROM customers WHERE id=? AND business_id=?", [Number(id), b.id]);
  if (!c) return fail("Customer not found", 404);
  const cancelled = await cancelPending(b.id, c.phone, "cancelled by owner");
  if (cancelled) await logEvent(b.id, "cancelled", `${c.name || c.phone}: scheduled text stopped by owner`);
  return json({ ok: true, cancelled });
}
