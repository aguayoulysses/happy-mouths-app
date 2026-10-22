// Daily: copy Twilio's real per-message prices onto our message log.
import { json, cronAuthorized } from "@/lib/api";
import { priceMessages } from "@/lib/costs";
import { run } from "@/lib/db";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  const out = await priceMessages();
  await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('costs', 1, ?)", [JSON.stringify(out)]);
  return json(out);
}
