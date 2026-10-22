import { one } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const row = await one<{ content_type: string; data: ArrayBuffer | Uint8Array }>("SELECT content_type, data FROM media WHERE key=?", [key.replace(/\.[a-z]+$/, "")]);
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.data as ArrayBuffer), {
    headers: { "content-type": row.content_type, "cache-control": "public, max-age=31536000, immutable" },
  });
}
