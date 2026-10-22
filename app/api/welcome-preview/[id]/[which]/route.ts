// Ops only: the client's review pictures for the welcome page preview (/welcome/preview/<id>), drawn for "Maria".

import { isAdmin } from "@/lib/auth";
import { one } from "@/lib/db";
import { renderPoster, resolveTemplate } from "@/lib/poster-render";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; which: string }> }) {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });
  const { id, which } = await ctx.params;
  const b = await one<{ id: number; poster_template: string; meme_template: string }>("SELECT id, poster_template, meme_template FROM businesses WHERE id=?", [Number(id)]);
  const key = !b ? "" : which.startsWith("sign") ? b.poster_template : which.startsWith("meme") ? b.meme_template : "";
  const owned = key.startsWith("db:") && b ? Boolean(await one("SELECT 1 AS x FROM poster_images WHERE id=? AND business_id=?", [Number(key.slice(3)), b.id])) : Boolean(key);
  const tpl = owned ? await resolveTemplate(key) : null;
  if (!tpl) return new Response("Not found", { status: 404 });
  const jpg = await renderPoster("Maria", tpl);
  return new Response(new Uint8Array(jpg), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
}
