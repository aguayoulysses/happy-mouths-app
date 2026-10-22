import { json, fail, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { one, run } from "@/lib/db";

export const OPTIONS = preflight;

// A photo can be pulled back while it is still waiting. Once it is on Google it is theirs to manage there.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const id = Number((await ctx.params).id);
  const p = await one<{ status: string; url: string }>("SELECT status, url FROM photos WHERE id=? AND business_id=?", [id, b.id]);
  if (!p) return fail("Photo not found.", 404);
  if (p.status === "posted") return fail("That photo is already on Google.", 409);
  await run("DELETE FROM photos WHERE id=?", [id]);
  const key = p.url.split("/").pop()?.replace(/\.[a-z]+$/, "") ?? "";
  if (key) await run("DELETE FROM media WHERE key=? AND business_id=?", [key, b.id]);
  return json({ deleted: true });
}
