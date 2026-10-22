// Daily (10am Pacific): ask owners with an empty queue for photos, and post the next waiting Google profile photo for each business whose drip window is open.
import { json, cronAuthorized } from "@/lib/api";
import { sweepPhotos, nudgeForPhotos } from "@/lib/photos";
import { run } from "@/lib/db";

export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  const out = { ...(await sweepPhotos()), nudged: await nudgeForPhotos() };
  await run("INSERT INTO cron_runs (name, ok, detail) VALUES ('photos', 1, ?)", [JSON.stringify(out)]);
  return json(out);
}
