// The owner's own review pictures on their welcome page, drawn for a sample customer name so they see exactly
// what their customers get: /api/welcome/<token>/sign.jpg and /meme.jpg. Only for that business's own photos.

import { one } from "@/lib/db";
import { renderPoster, resolveTemplate } from "@/lib/poster-render";

export const runtime = "nodejs";

const SAMPLE = "Maria";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string; which: string }> }) {
  const { token, which } = await ctx.params;
  if (!token || token.length < 16) return new Response("Not found", { status: 404 });
  const b = await one<{ id: number; poster_template: string; meme_template: string }>("SELECT id, poster_template, meme_template FROM businesses WHERE welcome_token=?", [token]);
  const key = !b ? "" : which.startsWith("sign") ? b.poster_template : which.startsWith("meme") ? b.meme_template : "";
  const owned = key.startsWith("db:") && b ? Boolean(await one("SELECT 1 AS x FROM poster_images WHERE id=? AND business_id=?", [Number(key.slice(3)), b.id])) : Boolean(key);
  const tpl = owned ? await resolveTemplate(key) : null;
  if (!tpl) return new Response("Not found", { status: 404 });
  const jpg = await renderPoster(SAMPLE, tpl);
  return new Response(new Uint8Array(jpg), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
}
