import { json, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all } from "@/lib/db";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const rows = await all(
    `SELECT id, star_rating, comment, reviewer_name, create_time, reply_comment, reply_time
     FROM reviews WHERE business_id=? ORDER BY create_time DESC LIMIT 200`,
    [b.id]
  );
  return json({ reviews: rows, linked: Boolean(b.gbp_location_id) });
}
