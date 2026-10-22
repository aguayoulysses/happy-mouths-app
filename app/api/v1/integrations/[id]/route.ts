import { json, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { run } from "@/lib/db";

export const OPTIONS = preflight;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { id } = await ctx.params;
  const input = await body<{ enabled?: boolean; signing_secret?: string }>(req);
  if (input.enabled !== undefined) await run("UPDATE integrations SET enabled=? WHERE id=? AND business_id=?", [input.enabled ? 1 : 0, Number(id), b.id]);
  if (typeof input.signing_secret === "string") await run("UPDATE integrations SET signing_secret=? WHERE id=? AND business_id=?", [input.signing_secret.trim(), Number(id), b.id]);
  return json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { id } = await ctx.params;
  await run("DELETE FROM integrations WHERE id=? AND business_id=?", [Number(id), b.id]);
  return json({ ok: true });
}
