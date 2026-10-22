import { json, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all } from "@/lib/db";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const rows = await all("SELECT id, kind, detail, created_at FROM events WHERE business_id=? ORDER BY id DESC LIMIT 100", [b.id]);
  return json({ events: rows });
}
