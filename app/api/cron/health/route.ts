// Weekdays 10:30am Pacific: remind owners who have gone two weeks without adding a customer,
// and text us about any client who has gone a month without a new Google review.
import { json, cronAuthorized } from "@/lib/api";
import { nudgeForCustomers, alertOnQuietReviews } from "@/lib/health";
import { run } from "@/lib/db";

export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  const out = { nudged: await nudgeForCustomers(), quiet_reviews: await alertOnQuietReviews() };
  await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('health', 1, ?)", [JSON.stringify(out)]);
  return json(out);
}
