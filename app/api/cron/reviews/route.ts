import { json, fail, cronAuthorized } from "@/lib/api";
import { run } from "@/lib/db";
import { syncAllReviews } from "@/lib/reviews";

export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const out = await syncAllReviews();
  const failed = Object.values(out).some((v) => v && typeof v === "object" && "error" in (v as object));
  await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('reviews', ?, ?)", [failed ? 0 : 1, JSON.stringify(out).slice(0, 2000)]);
  return json(out);
}
