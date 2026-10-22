import { json, fail, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { sendNow } from "@/lib/requests";
import { one } from "@/lib/db";
import { isBlocked } from "@/lib/dnc";

export const OPTIONS = preflight;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { id } = await ctx.params;
  const c = await one<{ phone: string }>("SELECT phone FROM customers WHERE id=? AND business_id=?", [Number(id), b.id]);
  if (c && (await isBlocked(b.id, c.phone))) return fail("They're on your do-not-contact list. Allow them again first.", 409);
  const r = await sendNow(b, Number(id));
  if (!r) return fail("Customer not found", 404);
  return json({ request: r });
}
