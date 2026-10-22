// Daily: refresh Google's views and call taps for every linked profile.
import { json, cronAuthorized } from "@/lib/api";
import { syncAllInsights } from "@/lib/insights";
import { run } from "@/lib/db";

export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  const out = await syncAllInsights();
  const failed = Object.values(out).some((v) => typeof v === "object");
  await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('insights', ?, ?)", [failed ? 0 : 1, JSON.stringify(out).slice(0, 2000)]);
  return json(out);
}
