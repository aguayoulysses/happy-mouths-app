// Sales CRM data: pipeline stages, follow-ups and the
// calendar. All dates are naive Pacific time strings so "today" means the team's today:
// follow-ups are YYYY-MM-DD, events are YYYY-MM-DDTHH:MM.

import { all, one, run } from "./db";
import { normalizePhone } from "./phone";
import { fireAndSend } from "./imessage";

export const TZ = "America/Los_Angeles";

/** The built-in stages. The live list (with custom columns and the team's order) is sales_stages; see loadStages(). */
export const STAGES = [
  { key: "new", label: "New lead", hint: "Call within 5 minutes" },
  { key: "intro_taken", label: "Intro call taken", hint: "Empty" },
  { key: "intro_noshow", label: "Intro no show", hint: "Empty" },
  { key: "demo_booked", label: "Demo booked", hint: "Empty" },
  { key: "demo_noshow", label: "Demo no show", hint: "Empty" },
  { key: "demo_taken", label: "Demo taken", hint: "Empty" },
  { key: "won", label: "Closed won", hint: "Empty" },
  { key: "lost", label: "Closed lost", hint: "Empty" },
] as const;
/** Columns every board starts with on top of the built-ins. Unlike those they can be removed. */
export const STARTER_STAGES = [
  { key: "ghosted", label: "Ghosted" },
  { key: "follow_up_30", label: "30 day follow up" },
  { key: "follow_up_60", label: "60 day follow up" },
] as const;
/** Parking columns keyed follow_up_<days> book the next follow-up that many days out. */
export const parkDays = (stage: string): number => Number(/^follow_up_(\d+)$/.exec(stage)?.[1] ?? 0);
export const OPEN_STAGES = STAGES.filter((s) => s.key !== "won" && s.key !== "lost").map((s) => s.key as string);
export const EVENT_KINDS = [
  { key: "intro", label: "Intro call" },
  { key: "demo", label: "Demo" },
  { key: "followup", label: "Follow-up call" },
] as const;
export type BuiltinStage = (typeof STAGES)[number]["key"];
export type Stage = string;
export type StageDef = { key: string; label: string; builtin: boolean };

// Last list read from sales_stages, so stageLabel() can stay synchronous in pages and
// actions that already called loadStages(). Starts as the built-ins.
let stageCache: StageDef[] = STAGES.map((s) => ({ key: s.key, label: s.label, builtin: true }));

/** The pipeline columns in board order. Seeds the table with the built-ins the first time. */
export async function loadStages(): Promise<StageDef[]> {
  let rows = await all<{ key: string; label: string; builtin: number }>("SELECT key, label, builtin FROM sales_stages ORDER BY position, rowid");
  if (rows.length === 0) {
    // Built-ins in order, with the starter columns slotted in before Closed won / Closed lost.
    const seed = [
      ...STAGES.filter((s) => s.key !== "won" && s.key !== "lost").map((s) => ({ ...s, builtin: 1 })),
      ...STARTER_STAGES.map((s) => ({ ...s, builtin: 0 })),
      ...STAGES.filter((s) => s.key === "won" || s.key === "lost").map((s) => ({ ...s, builtin: 1 })),
    ];
    for (const [i, s] of seed.entries()) await run("INSERT OR IGNORE INTO sales_stages (key, label, position, builtin) VALUES (?,?,?,?)", [s.key, s.label, i, s.builtin]);
    rows = await all("SELECT key, label, builtin FROM sales_stages ORDER BY position, rowid");
  }
  stageCache = rows.map((r) => ({ key: r.key, label: r.label, builtin: Number(r.builtin) === 1 }));
  return stageCache;
}
export const stageKeys = () => stageCache.map((s) => s.key);
/** Where a lead came from. Meta leads set themselves; the rest are picked when a lead is added by hand. */
export const SOURCES = [
  { key: "meta", label: "Meta ad" },
  { key: "cold_call", label: "Cold call" },
  { key: "door", label: "Door to door" },
  { key: "referral", label: "Referral" },
  { key: "walk_in", label: "Walk-in" },
  { key: "website", label: "Website" },
  { key: "imessage", label: "Texted us" },
  { key: "manual", label: "Other" },
] as const;
export const MANUAL_SOURCES = SOURCES.filter((s) => s.key !== "meta");
export const sourceLabel = (k: string) => SOURCES.find((s) => s.key === k)?.label ?? k;
export const stageLabel = (k: string) => stageCache.find((s) => s.key === k)?.label ?? STAGES.find((s) => s.key === k)?.label ?? k;

export type Deal = {
  id: number; source: string; lead_id: string; name: string; business_name: string; phone: string; email: string; trade: string; city: string;
  stage: Stage; owner_key: string; value_cents: number; one_time_cents: number; closed_at: string; next_follow_up: string; lost_reason: string; notes: string; last_touch_at: string; created_at: string; updated_at: string;
};
export type DealItem = { id: number; deal_id: number; label: string; kind: "one_time" | "monthly"; amount_cents: number; created_at: string };
/** The lines sold on a deal, oldest first. */
export const dealItems = (dealId: number) => all<DealItem>("SELECT * FROM sales_deal_items WHERE deal_id=? ORDER BY id", [dealId]);
/** Copies the line sums onto the deal so the board, stats and leaderboard keep reading the two columns. No lines = columns left alone. */
export async function syncDealTotals(dealId: number): Promise<{ oneTime: number; monthly: number } | null> {
  const r = await one<{ n: number; o: number; m: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN kind='one_time' THEN amount_cents END),0) AS o, COALESCE(SUM(CASE WHEN kind='monthly' THEN amount_cents END),0) AS m FROM sales_deal_items WHERE deal_id=?", [dealId]);
  if (!r || Number(r.n) === 0) return null;
  await run("UPDATE sales_deals SET one_time_cents=?, value_cents=?, updated_at=datetime('now') WHERE id=?", [Number(r.o), Number(r.m), dealId]);
  return { oneTime: Number(r.o), monthly: Number(r.m) };
}
export type Touch = { id: number; deal_id: number; kind: string; body: string; rep_key: string; created_at: string };
export type SalesEvent = { id: number; deal_id: number; kind: string; title: string; starts_at: string; minutes: number; rep_key: string; outcome: string; created_at: string; deal_name?: string; deal_business?: string; deal_stage?: string };

/** YYYY-MM-DD in Pacific time, optionally shifted by whole days. */
export function pacificDate(shiftDays = 0, from = new Date()): string {
  const d = new Date(from.getTime() + shiftDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** YYYY-MM-DDTHH:MM in Pacific time. */
export function pacificNow(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Tue, Sep 30" from a YYYY-MM-DD. */
export function niceDate(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
/** "2:30 PM" from a YYYY-MM-DDTHH:MM. */
export function niceTime(dt: string): string {
  const m = dt.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
/** Relative label for a follow-up date against Pacific today. */
export function dueLabel(ymd: string, today = pacificDate()): { text: string; tone: "overdue" | "today" | "soon" | "later" | "none" } {
  if (!ymd) return { text: "No follow-up set", tone: "none" };
  if (ymd < today) {
    const days = Math.round((Date.parse(today) - Date.parse(ymd)) / 86400000);
    return { text: `${days} day${days === 1 ? "" : "s"} overdue`, tone: "overdue" };
  }
  if (ymd === today) return { text: "Due today", tone: "today" };
  if (ymd === pacificDate(1)) return { text: "Tomorrow", tone: "soon" };
  return { text: niceDate(ymd), tone: "later" };
}
/** "3h ago" / "2d ago" from a SQLite UTC timestamp. */
export function ago(sqliteUtc: string): string {
  if (!sqliteUtc) return "";
  const t = Date.parse(sqliteUtc.replace(" ", "T") + "Z");
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Every Meta lead we have texted about becomes a deal in "New lead", once. */
export async function syncDealsFromMetaLeads(): Promise<number> {
  const rows = await all<{ leadgen_id: string; name: string; phone: string; email: string; fields_json: string; created_at: string; ad_name: string }>(
    "SELECT leadgen_id, name, phone, email, fields_json, created_at, ad_name FROM meta_leads WHERE leadgen_id NOT IN (SELECT lead_id FROM sales_deals WHERE lead_id != '') AND leadgen_id NOT IN (SELECT lead_id FROM sales_deleted_leads) AND leadgen_id NOT LIKE 'curl-test-%' AND leadgen_id NOT LIKE 'sheet-test-%' AND leadgen_id NOT LIKE 'test-%' ORDER BY created_at"
  );
  let n = 0;
  for (const r of rows) {
    let fields: Record<string, string> = {};
    try { fields = JSON.parse(r.fields_json || "{}"); } catch { /* keep empty */ }
    const business = Object.entries(fields).find(([k]) => k.includes("business"))?.[1] ?? "";
    if (/^<test lead/i.test(r.name) || /^<test lead/i.test(business)) continue;
    const res = await run(
      "INSERT OR IGNORE INTO sales_deals (source, lead_id, name, business_name, phone, email, stage, next_follow_up, notes, created_at) VALUES ('meta',?,?,?,?,?,'new',?,?,?)",
      [r.leadgen_id, r.name, business, normalizePhone(r.phone || ""), r.email, pacificDate(), r.ad_name ? `Ad: ${r.ad_name}` : "", r.created_at]
    );
    if (res.changes) {
      await run("INSERT INTO sales_touches (deal_id, kind, body, rep_key) VALUES (?,?,?,?)", [res.lastId, "system", "Came in from the Meta ad form", ""]);
      // The iMessage automations, only for a lead from the last day (an old lead synced late is not texted out of the blue).
      if (Date.now() - new Date(r.created_at.replace(" ", "T") + "Z").getTime() < 86400_000) await fireAndSend("lead_new", { kind: "deal", id: res.lastId });
      n++;
    }
  }
  return n;
}

export async function dueCounts(): Promise<{ overdue: number; today: number }> {
  const today = pacificDate();
  const r = await one<{ overdue: number; today: number }>(
    "SELECT SUM(CASE WHEN next_follow_up < ? THEN 1 ELSE 0 END) AS overdue, SUM(CASE WHEN next_follow_up = ? THEN 1 ELSE 0 END) AS today FROM sales_deals WHERE next_follow_up != '' AND stage NOT IN ('won','lost')",
    [today, today]
  );
  return { overdue: Number(r?.overdue ?? 0), today: Number(r?.today ?? 0) };
}

export async function eventsBetween(fromYmd: string, toYmd: string): Promise<SalesEvent[]> {
  return all<SalesEvent>(
    "SELECT e.*, d.name AS deal_name, d.business_name AS deal_business, d.stage AS deal_stage FROM sales_events e LEFT JOIN sales_deals d ON d.id=e.deal_id WHERE e.starts_at >= ? AND e.starts_at < ? ORDER BY e.starts_at",
    [fromYmd, toYmd + "T99"]
  );
}

export type Range = { key: string; label: string; from: string; to: string };
/** Date ranges for the stats row, Pacific. `to` is exclusive. */
export function ranges(): Range[] {
  const today = pacificDate();
  const ym = today.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`;
  return [
    { key: "month", label: "This month", from: `${ym}-01`, to: nextMonth },
    { key: "last", label: "Last month", from: prevMonth, to: `${ym}-01` },
    { key: "week", label: "Last 7 days", from: pacificDate(-6), to: pacificDate(1) },
    { key: "all", label: "All time", from: "0000-01-01", to: "9999-12-31" },
  ];
}

export type Stats = {
  leads: number; booked: number; ahead: number; taken: number; noshows: number; showRate: number | null;
  closed: number; closedOffCall: number; closeRate: number | null; oneTime: number; monthly: number;
  board: Array<{ key: string; monthly: number; oneTime: number; closed: number }>;
};
/** The funnel numbers for one range, optionally one rep. Dates are Pacific. */
export async function salesStats(r: Range, rep = ""): Promise<Stats> {
  const repDeal = rep ? " AND d.owner_key=?" : "";
  const repEv = rep ? " AND e.rep_key=?" : "";
  const a = (x: string[]) => (rep ? [...x, rep] : x);
  const now = pacificNow();
  const [leads, booked, ahead, taken, noshows, closed, closedOffCall, money, board] = await Promise.all([
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM sales_deals d WHERE created_at >= ? AND created_at < ?${repDeal}`, a([r.from, r.to])),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM sales_events e WHERE kind IN ('intro','demo') AND starts_at >= ? AND starts_at < ?${repEv}`, a([r.from, r.to])),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM sales_events e WHERE kind IN ('intro','demo') AND outcome='' AND starts_at >= ?${repEv}`, a([now])),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM sales_events e WHERE kind IN ('intro','demo') AND outcome='showed' AND starts_at >= ? AND starts_at < ?${repEv}`, a([r.from, r.to])),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM sales_events e WHERE kind IN ('intro','demo') AND outcome='noshow' AND starts_at >= ? AND starts_at < ?${repEv}`, a([r.from, r.to])),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM sales_deals d WHERE stage='won' AND closed_at >= ? AND closed_at < ?${repDeal}`, a([r.from, r.to])),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM sales_deals d WHERE stage='won' AND closed_at >= ? AND closed_at < ? AND EXISTS (SELECT 1 FROM sales_events e WHERE e.deal_id=d.id AND e.kind IN ('intro','demo'))${repDeal}`, a([r.from, r.to])),
    one<{ o: number; m: number }>(`SELECT COALESCE(SUM(one_time_cents),0) AS o, COALESCE(SUM(value_cents),0) AS m FROM sales_deals d WHERE stage='won' AND closed_at >= ? AND closed_at < ?${repDeal}`, a([r.from, r.to])),
    all<{ key: string; monthly: number; oneTime: number; closed: number }>("SELECT owner_key AS key, COALESCE(SUM(value_cents),0) AS monthly, COALESCE(SUM(one_time_cents),0) AS oneTime, COUNT(*) AS closed FROM sales_deals WHERE stage='won' AND closed_at >= ? AND closed_at < ? GROUP BY owner_key", [r.from, r.to]),
  ]);
  const t = Number(taken?.n ?? 0), ns = Number(noshows?.n ?? 0), c = Number(closed?.n ?? 0);
  return {
    leads: Number(leads?.n ?? 0), booked: Number(booked?.n ?? 0), ahead: Number(ahead?.n ?? 0), taken: t, noshows: ns,
    showRate: t + ns ? Math.round((t / (t + ns)) * 100) : null,
    closed: c, closedOffCall: Number(closedOffCall?.n ?? 0), closeRate: t ? Math.round((c / t) * 100) : null,
    oneTime: Number(money?.o ?? 0), monthly: Number(money?.m ?? 0),
    board: board.map((b) => ({ key: b.key, monthly: Number(b.monthly), oneTime: Number(b.oneTime), closed: Number(b.closed) })),
  };
}
