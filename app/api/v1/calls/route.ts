import { json, fail, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all } from "@/lib/db";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_phone) return fail("No business line on this account.", 404);
  const rows = await all<{ id: number; direction: string; from_number: string; to_number: string; status: string; duration: number; missed: number; texted_back: number; created_at: string; name: string | null }>(
    `SELECT c.id, c.direction, c.from_number, c.to_number, c.status, c.duration, c.missed, c.texted_back, c.created_at, cu.name
     FROM calls c LEFT JOIN customers cu ON cu.business_id = c.business_id AND cu.phone = CASE WHEN c.direction='out' THEN c.to_number ELSE c.from_number END
     WHERE c.business_id=? ORDER BY c.id DESC LIMIT 100`,
    [b.id]
  );
  return json({
    calls: rows.map((r) => ({
      id: Number(r.id),
      direction: r.direction === "out" ? "out" : "in",
      phone: r.direction === "out" ? r.to_number : r.from_number,
      name: r.name ?? "",
      status: r.status,
      duration: Number(r.duration),
      missed: Boolean(Number(r.missed)),
      texted_back: Boolean(Number(r.texted_back)),
      created_at: r.created_at,
    })),
  });
}
