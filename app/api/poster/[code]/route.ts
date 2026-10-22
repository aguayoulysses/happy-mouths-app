// The public image Twilio fetches for the MMS: the business's team photo with
// this customer's first name written on the sign. Rendered on request from the
// request code, so nothing is stored; the same code always yields the same image.

import { one } from "@/lib/db";
import { renderPoster, resolveTemplate } from "@/lib/poster-render";
import { firstName } from "@/lib/template";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = (await ctx.params).code.replace(/\.jpe?g$/i, "");
  const row = await one<{ name: string; poster_template: string; business_id: number }>(
    "SELECT c.name, b.poster_template, r.business_id FROM requests r JOIN customers c ON c.id=r.customer_id JOIN businesses b ON b.id=r.business_id WHERE r.code=?",
    [code]
  );
  // ?t= picks a follow-up's picture (a meme); without it, the business's sign photo.
  const key = new URL(req.url).searchParams.get("t") || row?.poster_template || "";
  // An uploaded photo only ever renders for its own business's customers.
  const owned = !key.startsWith("db:") || Boolean(row && (await one("SELECT 1 AS x FROM poster_images WHERE id=? AND business_id=?", [Number(key.slice(3)), row.business_id])));
  const tpl = row && owned ? await resolveTemplate(key) : null;
  if (!row || !tpl) return new Response("Not found", { status: 404 });
  const jpg = await renderPoster(firstName(row.name) || "You", tpl);
  return new Response(new Uint8Array(jpg), {
    headers: { "content-type": "image/jpeg", "content-length": String(jpg.length), "cache-control": "public, max-age=86400, immutable" },
  });
}
