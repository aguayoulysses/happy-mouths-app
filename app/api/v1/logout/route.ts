import { json, preflight } from "@/lib/api";
import { destroySession } from "@/lib/auth";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) await destroySession(header.slice(7));
  return json({ ok: true });
}
