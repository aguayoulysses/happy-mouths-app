// Daily: is every client's website up, and does their review link still reach us?
import { json, cronAuthorized } from "@/lib/api";
import { run } from "@/lib/db";
import { checkAllSites } from "@/lib/sites";

export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  const out = await checkAllSites();
  const failed = Object.values(out).some((r) => !r.ok);
  await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('sites', ?, ?)", [failed ? 0 : 1, JSON.stringify(out).slice(0, 2000)]);
  return json(out);
}
