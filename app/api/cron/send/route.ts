import { json, fail, cronAuthorized } from "@/lib/api";
import { run } from "@/lib/db";
import { sendDueRequests } from "@/lib/requests";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  try {
    const out = await sendDueRequests();
    await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('send', 1, ?)", [JSON.stringify(out)]);
    return json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('send', 0, ?)", [msg]);
    return fail(msg, 500);
  }
}
