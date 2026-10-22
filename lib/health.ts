// Client health for the ops board: every business gets a list of flags, and
// the worst flag decides whether it reads Healthy, Watch or At risk. The rules
// are the ways a client quietly stops getting value before they cancel:
// Google unlinked or failing, no new customers coming in, texts not leaving,
// reviews not arriving, nobody answering them in the chat.
//
// One query gathers the numbers for every business; the rules are plain code
// below it so they are easy to read and change.

import { all, one, run } from "./db";
import { pushToBusiness, pushConfigured } from "./push";
import { sendToOwner, alertOps } from "./sms";
import { baseUrl } from "./template";
import { gbpConfigured } from "./gbp";
import { aiConfigured } from "./ai";
import { calendarConfigured } from "./calendar";
import { twilioConfigured } from "./twilio";
import { ALERT_TO } from "./meta-leads";
import { prettyPhone } from "./phone";
import type { Business } from "./auth";
import { NAME } from "@/lib/whitelabel";

export type Flag = { level: "red" | "amber"; label: string; detail: string };
export type Health = "risk" | "watch" | "healthy" | "off";

export type ClientHealth = {
  id: number; slug: string; name: string; owner_name: string; email: string; status: string; trial_ends_at: string;
  logo_url: string;
  plan_cents: number; months: number; created_at: string;
  features: { phone: boolean; messages: boolean; invoices: boolean; photos: boolean };
  customers: number; customers_14d: number; last_customer_at: string;
  sent_30d: number; reviewed_30d: number; reviews_30d: number; last_sent: string;
  reviews_total: number; last_review_at: string; reply_stuck: number;
  views: number | null; views_prev: number | null; calls: number | null;
  chat_unread: number;
  flags: Flag[]; health: Health;
};

type Raw = Business & {
  customers: number; customers_14d: number; last_customer_at: string | null;
  sent_30d: number; reviewed_30d: number; failed_7d: number; sent_7d: number; overdue: number; last_sent: string | null; used_month: number;
  reviews_30d: number; reviews_total: number; last_review_at: string | null; reply_stuck: number;
  push_tokens: number; chat_unread: number; chat_oldest: string | null;
  photos_waiting: number; photos_total: number;
  views: number | null; views_prev: number | null; calls: number | null;
};

/** A linked client with no new Google review for this long is a red flag and a text to us. */
export const REVIEW_DROUGHT_DAYS = 30;

const daysSince = (s: string | null | undefined) => (s ? Math.floor((Date.now() - new Date(s.replace(" ", "T") + (s.includes("T") ? "" : "Z")).getTime()) / 86400e3) : Infinity);
const hoursSince = (s: string | null | undefined) => (s ? (Date.now() - new Date(s.replace(" ", "T") + "Z").getTime()) / 3600e3 : Infinity);

/** Per-business error text from the latest Google review sync, if that run failed for them. */
async function googleSyncErrors(): Promise<Record<string, string>> {
  const last = await one<{ detail: string }>("SELECT detail FROM cron_runs WHERE name='reviews' ORDER BY id DESC LIMIT 1");
  const out: Record<string, string> = {};
  try {
    const parsed = JSON.parse(last?.detail ?? "{}") as Record<string, { error?: string }>;
    for (const [slug, v] of Object.entries(parsed)) if (v && typeof v === "object" && v.error) out[slug] = String(v.error);
  } catch {
    /* truncated JSON: nothing to report */
  }
  return out;
}

export function flagsFor(r: Raw, syncError?: string): Flag[] {
  const f: Flag[] = [];
  const add = (level: Flag["level"], label: string, detail: string) => f.push({ level, label, detail });
  const age = daysSince(r.created_at);

  // Launch: the welcome text went out and nobody opened the page in 48 hours. Call them.
  const wel = r as unknown as { welcome_sent_at?: string; welcome_opened_at?: string };
  if (wel.welcome_sent_at && !wel.welcome_opened_at && hoursSince(wel.welcome_sent_at) > 48) add("amber", "Welcome not opened", `Texted ${wel.welcome_sent_at.slice(0, 10)}, page never opened. Call the owner.`);

  // Google
  if (!r.gbp_location_id || r.gbp_location_id === "pending") add("red", "Google not linked", "Reviews can't sync, replies can't post, photos can't go up.");
  else if (syncError) add("red", "Google sync failing", syncError.slice(0, 140));

  // Customers coming in: the thing that predicts a cancel
  if (r.customers === 0) {
    if (age > 3) add("red", "No customers added", `Account is ${age} days old and has never had a customer.`);
  } else {
    const d = daysSince(r.last_customer_at);
    if (d > 30) add("red", `No new customers in ${d} days`, "Nothing to ask for reviews. Call them.");
    else if (d > 14) add("amber", `No new customers in ${d} days`, "We nudge the owner automatically every two weeks.");
  }

  // Texts leaving
  if (r.overdue > 0) add("red", `${r.overdue} text${r.overdue === 1 ? "" : "s"} stuck`, "Scheduled more than an hour ago and still not sent. Check the send cron and Twilio.");
  if (r.failed_7d >= 3 || (r.sent_7d >= 5 && r.failed_7d / r.sent_7d > 0.2)) add("red", `${r.failed_7d} texts failed this week`, "Open the business and read the message log.");
  if (r.monthly_limit > 0 && r.used_month >= r.monthly_limit) add("red", "Monthly limit reached", `${r.used_month} of ${r.monthly_limit} used. New requests wait until next month.`);
  else if (r.monthly_limit > 0 && r.used_month >= r.monthly_limit * 0.9) add("amber", "Near monthly limit", `${r.used_month} of ${r.monthly_limit} used.`);

  // Their website: the review link and the quotes live on it
  if (r.website && r.site_checked_at && !r.site_ok) add("red", r.site_detail.startsWith("Review link") ? "Review link on their site broken" : "Website down", r.site_detail);

  // Reviews arriving: the product is new reviews, so a quiet month is the loudest signal we have.
  const linked = Boolean(r.gbp_location_id) && r.gbp_location_id !== "pending";
  if (linked) {
    const quiet = r.reviews_total ? daysSince(r.last_review_at) : age;
    if (quiet >= REVIEW_DROUGHT_DAYS) add("red", r.reviews_total ? `No new review in ${quiet} days` : "Never had a review", r.reviews_total ? `Last one landed ${r.last_review_at!.slice(0, 10)}. ${r.sent_30d ? `${r.sent_30d} asked in 30 days.` : "Nobody asked in 30 days."} Call them.` : `Linked ${age} days and nothing on Google yet.`);
    else if (quiet >= 21) add("amber", `No new review in ${quiet} days`, `Goes red at ${REVIEW_DROUGHT_DAYS}. ${r.sent_30d ? `${r.sent_30d} asked in 30 days.` : "Nobody asked in 30 days."}`);
    if (r.reply_stuck > 0) add("red", `${r.reply_stuck} review${r.reply_stuck === 1 ? "" : "s"} unanswered`, r.auto_reply ? "Auto-reply should have posted within the hour. Open Reviews and check the failure." : "Auto-reply is off for this client. Post it from Reviews or switch it on.");
  }
  if (r.sent_30d >= 10 && r.reviewed_30d === 0 && r.reviews_30d === 0) add("amber", "Asking but no reviews", `${r.sent_30d} requests in 30 days and none turned into a review. Check the link and the wording.`);

  // Us
  if (r.chat_unread > 0) {
    const h = hoursSince(r.chat_oldest);
    add(h > 24 ? "red" : "amber", "Waiting on us in chat", `${r.chat_unread} unread, oldest ${h < 1 ? "just now" : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`}.`);
  }

  // Trial
  if (r.status === "trial" && r.trial_ends_at) {
    const left = Math.ceil((new Date(r.trial_ends_at + "T23:59:59Z").getTime() - Date.now()) / 86400e3);
    if (left < 0) add("red", "Trial ended", `Ended ${r.trial_ends_at} and still marked trial. Convert or pause.`);
    else if (left <= 3) add("amber", `Trial ends in ${left} day${left === 1 ? "" : "s"}`, "Time for the close call.");
  }

  // Setup gaps
  if (r.push_tokens === 0 && age > 2) add("amber", "App not installed", "No phone is registered for notifications.");
  if (!r.owner_phone && !r.forward_to) add("amber", "No owner cell", "Alerts and call forwarding have nowhere to go.");
  if (r.feature_phone && !r.twiml_app_sid) add("amber", "Phone on, not wired", "Press Set up phone line on their page.");
  if (r.feature_photos && r.photos_waiting === 0 && r.gbp_location_id && r.gbp_location_id !== "pending") add("amber", "Out of photos", r.photos_total ? "Queue is empty. They get a weekly reminder." : "They have never sent a photo.");

  // Google trend
  if (r.views !== null && r.views_prev && r.views_prev >= 50 && r.views < r.views_prev * 0.7) add("amber", `Seen on Google down ${Math.round((1 - r.views / r.views_prev) * 100)}%`, `${r.views} views in 30 days, ${r.views_prev} the month before.`);

  return f.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
}

export async function clientHealth(): Promise<ClientHealth[]> {
  const rows = await all<Raw>(
    `SELECT b.*,
       (SELECT COUNT(*) FROM customers c WHERE c.business_id=b.id) AS customers,
       (SELECT COUNT(*) FROM customers c WHERE c.business_id=b.id AND c.created_at >= datetime('now','-14 days')) AS customers_14d,
       (SELECT MAX(created_at) FROM customers c WHERE c.business_id=b.id) AS last_customer_at,
       (SELECT COUNT(*) FROM requests r WHERE r.business_id=b.id AND r.status != 'queued' AND r.sent_at >= datetime('now','-30 days')) AS sent_30d,
       (SELECT COUNT(*) FROM requests r WHERE r.business_id=b.id AND r.status = 'reviewed' AND r.reviewed_at >= datetime('now','-30 days')) AS reviewed_30d,
       (SELECT COUNT(*) FROM requests r WHERE r.business_id=b.id AND r.status = 'failed' AND r.created_at >= datetime('now','-7 days')) AS failed_7d,
       (SELECT COUNT(*) FROM requests r WHERE r.business_id=b.id AND r.status != 'queued' AND r.created_at >= datetime('now','-7 days')) AS sent_7d,
       (SELECT COUNT(*) FROM requests r WHERE r.business_id=b.id AND r.status = 'queued' AND r.next_at != '' AND r.next_at < datetime('now','-1 hour')) AS overdue,
       (SELECT MAX(sent_at) FROM requests r WHERE r.business_id=b.id) AS last_sent,
       (SELECT COUNT(*) FROM requests r WHERE r.business_id=b.id AND r.status != 'queued' AND strftime('%Y-%m', r.sent_at) = strftime('%Y-%m','now')) AS used_month,
       (SELECT COUNT(*) FROM reviews v WHERE v.business_id=b.id AND v.review_name NOT LIKE 'accounts/demo/%' AND v.create_time >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS reviews_30d,
       (SELECT COUNT(*) FROM reviews v WHERE v.business_id=b.id AND v.review_name NOT LIKE 'accounts/demo/%') AS reviews_total,
       (SELECT MAX(create_time) FROM reviews v WHERE v.business_id=b.id AND v.review_name NOT LIKE 'accounts/demo/%') AS last_review_at,
       (SELECT COUNT(*) FROM reviews v WHERE v.business_id=b.id AND v.review_name NOT LIKE 'accounts/demo/%' AND v.reply_comment='' AND v.created_at < datetime('now','-2 hours')) AS reply_stuck,
       (SELECT COUNT(*) FROM push_tokens p WHERE p.business_id=b.id) AS push_tokens,
       (SELECT COUNT(*) FROM team_messages t WHERE t.business_id=b.id AND t.sender='client' AND t.read_at IS NULL) AS chat_unread,
       (SELECT MIN(created_at) FROM team_messages t WHERE t.business_id=b.id AND t.sender='client' AND t.read_at IS NULL) AS chat_oldest,
       (SELECT COUNT(*) FROM photos ph WHERE ph.business_id=b.id AND ph.status != 'posted') AS photos_waiting,
       (SELECT COUNT(*) FROM photos ph WHERE ph.business_id=b.id) AS photos_total,
       (SELECT SUM(views) FROM gbp_daily g WHERE g.business_id=b.id AND g.date > date('now','-33 days') AND g.date <= date('now','-3 days')) AS views,
       (SELECT SUM(views) FROM gbp_daily g WHERE g.business_id=b.id AND g.date > date('now','-63 days') AND g.date <= date('now','-33 days')) AS views_prev,
       (SELECT SUM(calls) FROM gbp_daily g WHERE g.business_id=b.id AND g.date > date('now','-33 days') AND g.date <= date('now','-3 days')) AS calls
     FROM businesses b WHERE b.demo=0 ORDER BY b.id DESC`
  );
  const errors = await googleSyncErrors();
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const out = rows.map((r): ClientHealth => {
    const live = r.status === "active" || r.status === "trial";
    const raw: Raw = { ...r, customers: Number(r.customers), customers_14d: Number(r.customers_14d), sent_30d: Number(r.sent_30d), reviewed_30d: Number(r.reviewed_30d), failed_7d: Number(r.failed_7d), sent_7d: Number(r.sent_7d), overdue: Number(r.overdue), used_month: Number(r.used_month), reviews_30d: Number(r.reviews_30d), reviews_total: Number(r.reviews_total), last_review_at: r.last_review_at, reply_stuck: Number(r.reply_stuck), push_tokens: Number(r.push_tokens), chat_unread: Number(r.chat_unread), photos_waiting: Number(r.photos_waiting), photos_total: Number(r.photos_total), views: num(r.views), views_prev: num(r.views_prev), calls: num(r.calls) };
    const flags = live ? flagsFor(raw, errors[r.slug]) : [];
    return {
      id: r.id, slug: r.slug, name: r.name, owner_name: r.owner_name, email: r.email, status: r.status, trial_ends_at: r.trial_ends_at,
      logo_url: r.logo_url ?? "",
      plan_cents: Number(r.plan_cents), months: Math.max(1, Math.round(daysSince(r.created_at) / 30.4)), created_at: r.created_at,
      features: { phone: Boolean(r.feature_phone), messages: Boolean(r.feature_messages), invoices: Boolean(r.feature_invoices), photos: Boolean(r.feature_photos) },
      customers: raw.customers, customers_14d: raw.customers_14d, last_customer_at: r.last_customer_at ?? "",
      sent_30d: raw.sent_30d, reviewed_30d: raw.reviewed_30d, reviews_30d: raw.reviews_30d, last_sent: r.last_sent ?? "",
      reviews_total: raw.reviews_total, last_review_at: r.last_review_at ?? "", reply_stuck: raw.reply_stuck,
      views: raw.views, views_prev: raw.views_prev, calls: raw.calls, chat_unread: raw.chat_unread,
      flags, health: !live ? "off" : flags.some((x) => x.level === "red") ? "risk" : flags.length ? "watch" : "healthy",
    };
  });
  const order: Record<Health, number> = { risk: 0, watch: 1, healthy: 2, off: 3 };
  return out.sort((a, b) => order[a.health] - order[b.health] || b.flags.length - a.flags.length || b.id - a.id);
}

/* ---- The system itself: is every piece this business depends on actually configured and running? ---- */

export type SystemCheck = { label: string; ok: boolean; detail: string };

export async function systemChecks(): Promise<SystemCheck[]> {
  const checks: SystemCheck[] = [
    { label: "Texting (Twilio)", ok: twilioConfigured(), detail: "Sends review requests and customer texts." },
    { label: "Google profiles", ok: gbpConfigured(), detail: "Review sync, replies, photos, views and calls." },
    { label: "Claude", ok: aiConfigured(), detail: "Writes review replies and invoices." },
    { label: "Push notifications", ok: pushConfigured(), detail: "Alerts on the owner's phone." },
    { label: "Calendar", ok: calendarConfigured(), detail: "Support phone calls land on your Google Calendar." },
    { label: "Alerts to you", ok: ALERT_TO.length > 0 && twilioConfigured(), detail: `Texts ${ALERT_TO.map(prettyPhone).join(" and ")} on new leads, booked calls, client messages, referrals and quiet-review flags.` },
    { label: "Real sending", ok: process.env.SMS_DRY_RUN !== "true", detail: process.env.SMS_DRY_RUN === "true" ? "SMS_DRY_RUN is on: no text is actually leaving." : "Texts really send." },
  ];
  // Each cron must have run recently and its last run must have succeeded.
  const crons: [string, number, string][] = [["send", 0.5, "every 5 minutes"], ["reviews", 3, "hourly"], ["photos", 30, "daily"], ["insights", 30, "daily"], ["health", 30, "daily"], ["costs", 30, "daily"], ["sites", 30, "daily"]];
  // Latest run of every job in one round trip (this runs on every ops page load for the sidebar badge).
  const latest = await all<{ name: string; ok: number; created_at: string; detail: string }>("SELECT name, ok, created_at, detail FROM cron_runs WHERE id IN (SELECT MAX(id) FROM cron_runs GROUP BY name)");
  const byName = new Map(latest.map((r) => [r.name, r]));
  for (const [name, maxHours, cadence] of crons) {
    const last = byName.get(name);
    const h = hoursSince(last?.created_at);
    const fresh = h <= maxHours;
    checks.push({
      label: `Job: ${name}`,
      ok: Boolean(last) && fresh && Boolean(last!.ok),
      detail: !last ? `Has never run (should run ${cadence}).` : !fresh ? `Last ran ${Math.round(h)} hours ago (should run ${cadence}).` : last.ok ? `Ran ${h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.round(h)} h`} ago.` : `Last run failed: ${last.detail.slice(0, 120)}`,
    });
  }
  // The App Review demo board (HM_DEMO) is not wired to Twilio, Google or the crons on purpose.
  if (process.env.HM_DEMO === "1") return checks.map((c) => ({ ...c, ok: true, detail: `Demo board: sample status. ${c.label.startsWith("Job:") ? "Jobs run on the live board only." : c.detail}` }));
  return checks;
}

/* ---- The automatic nudge: two weeks with no new customers gets the owner a reminder, at most every 14 days ---- */

export async function nudgeForCustomers(): Promise<number> {
  const due = await all<Business>(
    `SELECT b.* FROM businesses b
     WHERE b.status IN ('active','trial') AND b.demo=0
       AND b.created_at < datetime('now','-7 days')
       AND (b.customers_nudged_at = '' OR b.customers_nudged_at < datetime('now','-14 days'))
       AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.business_id=b.id AND c.created_at >= datetime('now','-14 days'))`
  );
  for (const b of due) {
    await pushToBusiness(b.id, { title: "No new customers in two weeks", body: "Add the jobs you finished lately and we will ask each one for a review.", data: { kind: "customers" }, threadId: "customers" });
    if (b.owner_alerts && b.owner_phone) await sendToOwner(b, `${b.name}: it has been two weeks since you added a customer in ${NAME}. Add your recent jobs and we will ask each one for a review.`);
    await run("UPDATE businesses SET customers_nudged_at=datetime('now') WHERE id=?", [b.id]);
  }
  return due.length;
}

/* ---- The drought alert: a linked client with no new review in a month texts us, once per month until it changes ---- */

export async function alertOnQuietReviews(): Promise<string[]> {
  const clients = await clientHealth();
  const alerted: string[] = [];
  for (const c of clients) {
    if (c.health === "off") continue;
    const flag = c.flags.find((f) => f.level === "red" && (f.label.startsWith("No new review in") || f.label === "Never had a review"));
    if (!flag) continue;
    const last = await one<{ reviews_alerted_at: string }>("SELECT reviews_alerted_at FROM businesses WHERE id=?", [c.id]);
    if (last?.reviews_alerted_at && daysSince(last.reviews_alerted_at) < REVIEW_DROUGHT_DAYS) continue;
    await alertOps(`${NAME}: ${c.name} has ${flag.label.toLowerCase()}. ${flag.detail} ${baseUrl()}/admin/reviews?business=${c.id}`);
    await run("INSERT INTO events (business_id, kind, detail) VALUES (?, 'review_drought', ?)", [c.id, `${flag.label}: texted the team`]);
    await run("UPDATE businesses SET reviews_alerted_at=datetime('now') WHERE id=?", [c.id]);
    alerted.push(c.slug);
  }
  return alerted;
}
