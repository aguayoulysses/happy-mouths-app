import { json, fail, cronAuthorized } from "@/lib/api";
import { run } from "@/lib/db";
import { drainQueue } from "@/lib/imessage";

// Every minute: send the iMessage texts that are due (lib/imessage.ts).
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  try {
    const out = await drainQueue();
    if (out.sent || out.failed) await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('imessage', 1, ?)", [JSON.stringify(out)]);
    return json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('imessage', 0, ?)", [msg]);
    return fail(msg, 500);
  }
}
