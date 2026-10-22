// Public review feed for a client's own website. The site build fetches this instead of the
// Places API, so the numbers on the site are the same ones this app syncs from Google
// every hour, and a deploy hook rebuilds the site when a new one lands (lib/reviews.ts).
// Only what Google already shows publicly: name, stars, text, date. No keys, no auth.

import { all, one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = await one<{ id: number; name: string }>("SELECT id, name FROM businesses WHERE slug=? AND demo=0", [slug]);
  if (!b) return Response.json({ error: "Unknown business" }, { status: 404 });
  const rows = await all<{ reviewer_name: string; star_rating: number; comment: string; create_time: string; reply_comment: string }>(
    "SELECT reviewer_name, star_rating, comment, create_time, reply_comment FROM reviews WHERE business_id=? AND review_name NOT LIKE 'accounts/demo/%' ORDER BY create_time DESC",
    [b.id]
  );
  const count = rows.length;
  const rating = count ? Math.round((rows.reduce((n, r) => n + Number(r.star_rating), 0) / count) * 10) / 10 : 0;
  const reviews = rows.map((r) => ({
    name: r.reviewer_name || "Google user",
    stars: Number(r.star_rating),
    text: (r.comment || "").replace(/\s+/g, " ").trim(),
    time: r.create_time,
    reply: r.reply_comment || "",
  }));
  return Response.json(
    { business: b.name, rating, count, refreshed: new Date().toISOString(), reviews },
    { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } }
  );
}
