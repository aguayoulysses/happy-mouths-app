import { json, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { dashboardStats } from "@/lib/stats";
import { googleStats, lineStats } from "@/lib/insights";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const [stats, google, line] = await Promise.all([dashboardStats(b), googleStats(b), lineStats(b)]);
  return json({ ...stats, google, line });
}
