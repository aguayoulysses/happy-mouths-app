// Numbers for the owner's home screen. Everything comes from our own tables:
// requests (what we sent) and reviews (what Google shows).

import { all, one } from "./db";
import type { Business } from "./auth";

export type WeekPoint = { week: string; sent: number; reviewed: number };

export async function dashboardStats(b: Business) {
  const totals = await one<{ sent: number; opened: number; reviewed: number; queued: number; failed: number }>(
    `SELECT
       SUM(CASE WHEN status IN ('sent','opened','reviewed') THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status IN ('opened','reviewed') THEN 1 ELSE 0 END) AS opened,
       SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
       SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM requests WHERE business_id=?`,
    [b.id]
  );
  const month = await one<{ sent: number; opened: number; reviewed: number }>(
    `SELECT
       SUM(CASE WHEN status != 'queued' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status IN ('opened','reviewed') THEN 1 ELSE 0 END) AS opened,
       SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed
     FROM requests WHERE business_id=? AND created_at >= datetime('now','-28 days')`,
    [b.id]
  );
  const linked = Boolean(b.gbp_location_id);
  const reviewTotals = linked
    ? await one<{ total: number; recent: number; avg: number; unreplied: number }>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN create_time >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS recent,
                AVG(star_rating) AS avg,
                SUM(CASE WHEN reply_comment='' THEN 1 ELSE 0 END) AS unreplied
         FROM reviews WHERE business_id=?`,
        [b.id]
      )
    : null;

  // Eight ISO weeks, oldest first, zero-filled.
  const rows = await all<{ week: string; sent: number; reviewed: number }>(
    `SELECT strftime('%Y-%W', created_at) AS week,
            SUM(CASE WHEN status != 'queued' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status='reviewed' THEN 1 ELSE 0 END) AS reviewed
     FROM requests WHERE business_id=? AND created_at >= datetime('now','-56 days')
     GROUP BY week ORDER BY week`,
    [b.id]
  );
  const byWeek = new Map(rows.map((r) => [r.week, r]));
  const weeks: WeekPoint[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(Date.now() - i * 7 * 86400_000);
    const key = isoWeekKey(d);
    const r = byWeek.get(key);
    weeks.push({ week: key, sent: Number(r?.sent ?? 0), reviewed: Number(r?.reviewed ?? 0) });
  }

  const recent = await all(
    `SELECT r.id, r.customer_id, r.code, r.status, r.send_at, r.sent_at, r.opened_at, r.rated_at, r.reviewed_at, r.error, r.created_at,
            r.next_at, r.stop_reason, c.name, c.phone, c.source
     FROM requests r JOIN customers c ON c.id=r.customer_id
     WHERE r.business_id=? ORDER BY r.id DESC LIMIT 10`,
    [b.id]
  );
  const sent = Number(totals?.sent ?? 0);
  const receivedFromUs = Number(totals?.reviewed ?? 0);
  return {
    linked,
    tracking: Boolean(b.track_links || b.gate_enabled),
    requests: {
      sent,
      opened: Number(totals?.opened ?? 0),
      reviewed: Number(totals?.reviewed ?? 0),
      queued: Number(totals?.queued ?? 0),
      failed: Number(totals?.failed ?? 0),
      conversion: sent ? Math.round((receivedFromUs / sent) * 100) : 0,
    },
    month: {
      sent: Number(month?.sent ?? 0),
      opened: Number(month?.opened ?? 0),
      reviewed: Number(month?.reviewed ?? 0),
    },
    reviews: reviewTotals
      ? { total: Number(reviewTotals.total), last_30_days: Number(reviewTotals.recent ?? 0), average: Number(reviewTotals.avg ?? 0), unreplied: Number(reviewTotals.unreplied ?? 0) }
      : null,
    weeks,
    recent,
  };
}

/** Matches SQLite strftime('%Y-%W'): week of year with Monday as first day, zero-padded. */
function isoWeekKey(d: Date): string {
  const y = d.getUTCFullYear();
  const jan1 = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - jan1) / 86400_000);
  const jan1Dow = (new Date(jan1).getUTCDay() + 6) % 7; // Monday = 0
  const week = Math.floor((dayOfYear + jan1Dow) / 7);
  return `${y}-${String(week).padStart(2, "0")}`;
}
