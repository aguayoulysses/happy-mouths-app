import { json, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { run } from "@/lib/db";

export const OPTIONS = preflight;

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { id } = await ctx.params;
  await run("UPDATE requests SET next_at='', stop_reason='customer removed', status=CASE WHEN status='queued' THEN 'skipped' ELSE status END WHERE business_id=? AND customer_id=? AND next_at != ''", [b.id, Number(id)]);
  await run("DELETE FROM customers WHERE business_id=? AND id=?", [b.id, Number(id)]);
  return json({ ok: true });
}
