import { json, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all } from "@/lib/db";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit") ?? 50));
  const rows = await all(
    `SELECT r.id, r.customer_id, r.code, r.status, r.send_at, r.sent_at, r.opened_at, r.rated_at, r.reviewed_at, r.error, r.created_at,
            c.name, c.phone, c.source
     FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.business_id=? ORDER BY r.id DESC LIMIT ?`,
    [b.id, limit]
  );
  return json({ requests: rows });
}
