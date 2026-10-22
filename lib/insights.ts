// "From Google" on the owner's Home: how many people saw the profile and how
// many tapped Call, this 30 days against the 30 before. Google's numbers settle
// about three days late, so every window ends three days ago. The numbers are
// stored (gbp_daily) and refreshed daily; a dashboard never waits on Google
// unless that business has never been synced or the data is over a day old.

import { all, one, run } from "./db";
import { gbpConfigured, fetchDailyInsights } from "./gbp";
import type { Business } from "./auth";

const LAG_DAYS = 3;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const linked = (b: Pick<Business, "gbp_location_id">) => Boolean(b.gbp_location_id) && b.gbp_location_id !== "pending";

export async function syncInsights(b: Pick<Business, "id" | "gbp_location_id">): Promise<number> {
  if (!gbpConfigured() || !linked(b)) return 0;
  // 70 days covers both 30-day windows plus the lag, and re-reads recent days Google may have revised.
  const rows = await fetchDailyInsights(b.gbp_location_id, ymd(new Date(Date.now() - 70 * 86400e3)), ymd(new Date(Date.now() - 86400e3)));
  if (rows.length) {
    // One statement for the whole window: a row-at-a-time loop is 70 round trips to the database.
    await run(
      `INSERT INTO gbp_daily (business_id, date, views, calls) VALUES ${rows.map(() => "(?,?,?,?)").join(",")}
       ON CONFLICT(business_id, date) DO UPDATE SET views=excluded.views, calls=excluded.calls`,
      rows.flatMap((r) => [b.id, r.date, r.views, r.calls])
    );
  }
  await run("UPDATE businesses SET insights_synced_at=datetime('now') WHERE id=?", [b.id]);
  return rows.length;
}

export async function syncAllInsights(): Promise<Record<string, number | { error: string }>> {
  const out: Record<string, number | { error: string }> = {};
  const list = await all<Business>("SELECT * FROM businesses WHERE gbp_location_id != '' AND gbp_location_id != 'pending' AND status IN ('active','trial')");
  for (const b of list) {
    try {
      out[b.slug] = await syncInsights(b);
    } catch (err) {
      out[b.slug] = { error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
    }
  }
  return out;
}

export type GoogleStats = { views: number; views_prev: number; calls: number; calls_prev: number; through: string };

export async function googleStats(b: Business): Promise<GoogleStats | null> {
  if (!linked(b)) return null;
  const stale = !b.insights_synced_at || b.insights_synced_at < new Date(Date.now() - 26 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
  if (stale) {
    // Catch up, but never let Google hold the dashboard hostage.
    await Promise.race([syncInsights(b).catch((e) => console.error("[insights]", e)), new Promise((ok) => setTimeout(ok, 6000))]);
  }
  const end = ymd(new Date(Date.now() - LAG_DAYS * 86400e3));
  const mid = ymd(new Date(Date.now() - (LAG_DAYS + 30) * 86400e3));
  const start = ymd(new Date(Date.now() - (LAG_DAYS + 60) * 86400e3));
  const sum = (from: string, to: string) => one<{ views: number; calls: number; n: number }>("SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(calls),0) AS calls, COUNT(*) AS n FROM gbp_daily WHERE business_id=? AND date > ? AND date <= ?", [b.id, from, to]);
  const cur = await sum(mid, end), prev = await sum(start, mid);
  if (!Number(cur?.n ?? 0)) return null;
  return { views: Number(cur!.views), views_prev: Number(prev?.views ?? 0), calls: Number(cur!.calls), calls_prev: Number(prev?.calls ?? 0), through: end };
}

export type LineStats = { total: number; answered: number; missed: number; texted_back: number; outgoing: number };

/** What actually happened on the business line in the last 30 days (our own call log, not Google's guess). */
export async function lineStats(b: Business): Promise<LineStats | null> {
  if (!b.feature_phone) return null;
  const r = await one<{ total: number; answered: number; missed: number; texted: number; outgoing: number }>(
    `SELECT SUM(direction='in') AS total, SUM(direction='in' AND missed=0) AS answered, SUM(direction='in' AND missed=1) AS missed,
            SUM(direction='in' AND texted_back=1) AS texted, SUM(direction='out') AS outgoing
     FROM calls WHERE business_id=? AND created_at >= datetime('now','-30 days')`, [b.id]);
  return { total: Number(r?.total ?? 0), answered: Number(r?.answered ?? 0), missed: Number(r?.missed ?? 0), texted_back: Number(r?.texted ?? 0), outgoing: Number(r?.outgoing ?? 0) };
}
