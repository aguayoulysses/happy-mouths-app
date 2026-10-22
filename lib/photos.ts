// Photos for the Google profile drip out instead of dumping: one photo every
// GBP_DRIP_EVERY_DAYS days (default 3) per business. A steady trickle is a
// freshness signal Google rewards; a 50-photo burst is not. Uploads beyond the
// allowance wait as 'new' and the daily sweep posts the next one.

import { all, one, run, logEvent } from "./db";
import { gbpConfigured, createPhotoFromUrl } from "./gbp";
import { pushToBusiness } from "./push";

export function dripEveryDays(): number {
  const n = Number(process.env.GBP_DRIP_EVERY_DAYS ?? 3);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** True when this business has not posted a photo inside the drip window. */
export async function canPostNow(businessId: number): Promise<boolean> {
  const r = await one<{ n: number }>("SELECT COUNT(*) AS n FROM photos WHERE business_id=? AND gbp_posted_at != '' AND gbp_posted_at >= datetime('now', ?)", [businessId, `-${dripEveryDays()} days`]);
  return Number(r?.n ?? 0) === 0;
}

/** Pushes one photo to Google. Never throws; an upload must not fail because Google did. */
export async function pushPhoto(photoId: number): Promise<{ ok: boolean; detail: string }> {
  const row = await one<{ id: number; url: string; status: string; business_id: number; gbp_account_id: string; gbp_location_id: string }>(
    "SELECT p.id, p.url, p.status, p.business_id, b.gbp_account_id, b.gbp_location_id FROM photos p JOIN businesses b ON b.id = p.business_id WHERE p.id=?", [photoId]
  );
  if (!row) return { ok: false, detail: "photo not found" };
  if (row.status === "posted") return { ok: true, detail: "already posted" };
  if (!gbpConfigured()) return { ok: false, detail: "Google is not configured" };
  if (!row.gbp_account_id || !row.gbp_location_id || row.gbp_location_id === "pending") return { ok: false, detail: "no Google profile linked" };
  if (row.url.includes("localhost")) return { ok: false, detail: "local upload, Google cannot fetch it" };
  try {
    const name = await createPhotoFromUrl(row.gbp_account_id, row.gbp_location_id, row.url);
    await run("UPDATE photos SET status='posted', gbp_media_name=?, gbp_error='', gbp_posted_at=datetime('now') WHERE id=?", [name, photoId]);
    await logEvent(row.business_id, "photo", "A photo went live on Google");
    return { ok: true, detail: name };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await run("UPDATE photos SET status='failed', gbp_error=?, gbp_attempts=gbp_attempts+1 WHERE id=?", [detail.slice(0, 500), photoId]);
    return { ok: false, detail };
  }
}

/** Posts the oldest waiting photo for a business if its drip window is open. */
export async function postNextFor(businessId: number): Promise<{ ok: boolean; detail: string } | null> {
  if (!(await canPostNow(businessId))) return null;
  const next = await one<{ id: number }>("SELECT id FROM photos WHERE business_id=? AND status IN ('new','failed') AND gbp_attempts < 5 ORDER BY id LIMIT 1", [businessId]);
  return next ? pushPhoto(next.id) : null;
}

export async function sweepPhotos(): Promise<{ posted: number; failed: number }> {
  const ids = await all<{ business_id: number }>(
    "SELECT DISTINCT p.business_id FROM photos p JOIN businesses b ON b.id=p.business_id WHERE p.status IN ('new','failed') AND p.gbp_attempts < 5 AND b.feature_photos=1 AND b.gbp_location_id != '' AND b.gbp_location_id != 'pending'"
  );
  let posted = 0, failed = 0;
  for (const { business_id } of ids) {
    const r = await postNextFor(Number(business_id));
    if (r?.ok) posted++;
    else if (r) failed++;
  }
  return { posted, failed };
}

/**
 * The nudge that keeps profiles fresh: when a business's queue is empty (nothing waiting to go up),
 * ask for photos, at most once a week. Fresh job photos are the one thing only the owner can give us.
 */
export async function nudgeForPhotos(): Promise<number> {
  const due = await all<{ id: number; name: string }>(
    `SELECT b.id, b.name FROM businesses b
     WHERE b.feature_photos=1 AND b.notify_photos=1 AND b.demo=0 AND b.status IN ('active','trial')
       AND (b.photo_nudged_at='' OR b.photo_nudged_at < datetime('now','-7 days'))
       AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.business_id=b.id AND p.status != 'posted')`
  );
  let sent = 0;
  for (const b of due) {
    const n = await pushToBusiness(Number(b.id), {
      title: "Your Google profile needs fresh photos",
      body: "Snap a few from today's job and add them. We post them for you, one at a time.",
      data: { kind: "photos" },
      threadId: "photos",
    });
    await run("UPDATE businesses SET photo_nudged_at=datetime('now') WHERE id=?", [Number(b.id)]);
    if (n) sent++;
  }
  return sent;
}
