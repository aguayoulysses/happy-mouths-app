import { json, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { publicBusiness } from "@/lib/auth";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  return json({ business: publicBusiness(b) });
}
