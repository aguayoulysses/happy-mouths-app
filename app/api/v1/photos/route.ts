// The owner's job photos for their Google profile. One upload per request
// (the app sends them one at a time so a big batch never hits the body limit).

import { json, fail, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all, run } from "@/lib/db";
import { storeUpload } from "@/lib/media";
import { dripEveryDays, postNextFor } from "@/lib/photos";

export const OPTIONS = preflight;
export const maxDuration = 60;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_photos) return fail("Photos are not on for this account.", 404);
  const rows = await all<{ id: number; url: string; status: string; gbp_posted_at: string; created_at: string }>(
    "SELECT id, url, status, gbp_posted_at, created_at FROM photos WHERE business_id=? ORDER BY id DESC LIMIT 200", [b.id]
  );
  return json({
    every_days: dripEveryDays(),
    google_linked: Boolean(b.gbp_location_id) && b.gbp_location_id !== "pending",
    photos: rows.map((r) => ({ id: Number(r.id), url: r.url, status: r.status === "posted" ? "posted" : "waiting", posted_at: r.gbp_posted_at, created_at: r.created_at })),
  });
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_photos) return fail("Photos are not on for this account.", 404);
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File) || file.size === 0) return fail("Pick a photo first.");
  const url = await storeUpload(b.id, file);
  if (!url) return fail("That image is too large or not a photo.");
  // Google wants the address to look like a picture file.
  const { lastId } = await run("INSERT INTO photos (business_id, url) VALUES (?,?)", [b.id, `${url}.jpg`]);
  // First photo in a while goes up right away; the rest wait their turn.
  const posted = await postNextFor(b.id);
  return json({ id: lastId, posted_now: Boolean(posted?.ok) });
}
