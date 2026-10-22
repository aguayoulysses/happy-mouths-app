// Hourly: pull each linked business's Google reviews, store them, close the
// loop on requests whose customer name matches a fresh review, and buzz the
// owner about anything genuinely new. Google only exposes the reviewer's
// display name, so matching is first name + last initial when we have one.

import { all, one, run, logEvent } from "./db";
import type { Business } from "./auth";
import { gbpConfigured, listReviews, replyToReview, type GbpReview } from "./gbp";
import { pushToBusiness } from "./push";
import { aiConfigured, draftReviewReply, matchReviewer, type MatchCandidate } from "./ai";
import { GOOD } from "./feedback";
import { sendToOwner } from "./sms";
import { redeploySite } from "./sites";
import { namesMatch, firstNameOnly } from "./names";
import { NAME } from "@/lib/whitelabel";

export { namesMatch };

/**
 * When the customer last touched the review. Someone who reviewed the business a year ago and
 * taps our link lands on their old review and edits it: Google keeps the original createTime and
 * only moves updateTime. Going by createTime alone, that customer never counts as reviewed.
 */
function activityMs(r: { createTime: string; updateTime?: string }): number {
  const created = new Date(r.createTime).getTime();
  const updated = r.updateTime ? new Date(r.updateTime).getTime() : NaN;
  return Number.isFinite(updated) && updated > created ? updated : created;
}

export type StoredReview = {
  id: number;
  business_id: number;
  review_name: string;
  star_rating: number;
  comment: string;
  reviewer_name: string;
  create_time: string;
  reply_comment: string;
  reply_time: string;
  draft_reply: string;
  request_id: number;
  notified_at: string;
  created_at: string;
};

export async function syncBusinessReviews(b: Business): Promise<{ fetched: number; added: number; matched: number; replied: number }> {
  if (!gbpConfigured() || !b.gbp_account_id || !b.gbp_location_id) return { fetched: 0, added: 0, matched: 0, replied: 0 };
  if (b.gbp_account_id === "pending" || b.gbp_location_id === "pending") return { fetched: 0, added: 0, matched: 0, replied: 0 };
  const reviews = await listReviews(b.gbp_account_id, b.gbp_location_id);
  // Seeded demo reviews step aside the moment real ones arrive.
  await run("DELETE FROM reviews WHERE business_id=? AND review_name LIKE 'accounts/demo/%'", [b.id]);
  const before = await one<{ n: number }>("SELECT COUNT(*) AS n FROM reviews WHERE business_id=?", [b.id]);
  const firstSync = Number(before?.n ?? 0) === 0;
  let added = 0;
  const fresh: GbpReview[] = [];
  for (const r of reviews) {
    const res = await run(
      `INSERT INTO reviews (business_id, review_name, star_rating, comment, reviewer_name, create_time, reply_comment, reply_time)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(review_name) DO UPDATE SET star_rating=excluded.star_rating, comment=excluded.comment,
         reviewer_name=excluded.reviewer_name, reply_comment=excluded.reply_comment, reply_time=excluded.reply_time`,
      [b.id, r.reviewName, r.starRating, r.comment, r.reviewerName, r.createTime, r.replyComment, r.replyTime]
    );
    // libsql reports 1 changed row for both insert and update; detect "new" by created_at being just now.
    void res;
    const row = await one<{ id: number; created_at: string; notified_at: string }>("SELECT id, created_at, notified_at FROM reviews WHERE review_name=?", [r.reviewName]);
    if (row && row.notified_at === "") {
      added++;
      fresh.push(r);
    }
  }

  // Close the loop: requests still waiting whose customer matches a review written or edited after the request.
  let matched = 0;
  const open = await all<{ id: number; name: string; created_at: string; opened_at: string }>(
    `SELECT r.id, c.name, r.created_at, r.opened_at FROM requests r JOIN customers c ON c.id=r.customer_id
     WHERE r.business_id=? AND r.status IN ('sent','opened') AND c.name != ''`,
    [b.id]
  );
  const tracked = Boolean(b.track_links || b.gate_enabled);
  // One review belongs to one customer: a review already tied to a request is out of the running.
  const taken = new Set((await all<{ review_name: string }>("SELECT review_name FROM reviews WHERE business_id=? AND request_id != 0", [b.id])).map((x) => x.review_name));
  for (const req of open) {
    // A first name alone is thin ("Mary" on the list, "Mary Palladino" on Google). When the link records
    // taps and this customer never tapped, the second pass weighs them against the people who did.
    if (tracked && !req.opened_at && firstNameOnly(req.name)) continue;
    const since = new Date(req.created_at.replace(" ", "T") + "Z").getTime() - 6 * 3600 * 1000;
    const hit = reviews.find((rv) => !taken.has(rv.reviewName) && activityMs(rv) >= since && namesMatch(req.name, rv.reviewerName));
    if (!hit) continue;
    taken.add(hit.reviewName);
    await run("UPDATE requests SET status='reviewed', reviewed_at=datetime('now'), next_at='', stop_reason='reviewed' WHERE id=? AND status != 'reviewed'", [req.id]);
    await run("UPDATE reviews SET request_id=? WHERE review_name=? AND request_id=0", [req.id, hit.reviewName]);
    await logEvent(b.id, "reviewed", `${req.name} left ${hit.starRating} stars`);
    matched++;
  }

  matched += await resolveUnmatched(b, new Map(reviews.map((rv) => [rv.reviewName, activityMs(rv)])));

  // We answer reviews for the business. Automatic unless admin set the business to manual,
  // in which case Claude still writes the reply now and it waits in the queue for one click.
  const replied = b.auto_reply ? await autoReply(b) : 0;
  if (!b.auto_reply) await predraftReplies(b);

  // Notify on genuinely new reviews; the very first sync is history, not news.
  for (const r of fresh) {
    if (!firstSync) {
      const who = r.reviewerName || "Someone";
      const stars = "★".repeat(r.starRating) + "☆".repeat(5 - r.starRating);
      const answered = await one<{ reply_comment: string }>("SELECT reply_comment FROM reviews WHERE review_name=?", [r.reviewName]);
      const tail = answered?.reply_comment ? " We already replied." : "";
      await pushToBusiness(b.id, {
        title: r.starRating >= 4 ? `${who} left you ${r.starRating} stars ${stars}` : `${who} left a ${r.starRating}-star review ${stars}`,
        body: (r.comment ? `“${r.comment.slice(0, 110)}${r.comment.length > 110 ? "…" : ""}”` : "No written comment.") + tail,
        data: { kind: "review" },
        threadId: "reviews",
      });
      // Three stars or fewer is worth a text as well: the owner may want to call them today.
      if (r.starRating <= 3 && b.owner_alerts) {
        await sendToOwner(b, `${NAME}: ${who} just left ${b.name} a ${r.starRating}-star Google review${r.comment ? `: "${r.comment.slice(0, 160)}"` : "."}${tail} Open the app to see it.`);
      }
    }
    await run("UPDATE reviews SET notified_at=datetime('now') WHERE review_name=?", [r.reviewName]);
  }
  // Their website shows these reviews; rebuild it so the new one is on the site within the hour.
  if (fresh.length && !firstSync) await redeploySite(b, `${fresh.length} new review${fresh.length === 1 ? "" : "s"}`);
  return { fetched: reviews.length, added, matched, replied };
}

const MATCH_WINDOW_MIN = 60; // a tap this close before the review is strong evidence on its own
const MATCH_LOOKBACK_DAYS = 14; // customers asked longer ago than this are out of the running

/**
 * Second pass for reviews the strict name check could not link. Runs once per
 * review. Evidence: who tapped the link and rated 4-5 shortly before the review
 * posted, and whether the name on file could plausibly be the Google name.
 * One clean timing hit needs no AI. Anything murkier goes to Claude, who may
 * decline. Either way an unlinked review never restarts anyone's texts; the
 * gate already stopped everyone who rated well.
 */
export async function resolveUnmatched(b: Business, activity: Map<string, number> = new Map()): Promise<number> {
  const unlinked = await all<{ id: number; review_name: string; reviewer_name: string; create_time: string; star_rating: number }>(
    `SELECT id, review_name, reviewer_name, create_time, star_rating FROM reviews
     WHERE business_id=? AND request_id=0 AND match_checked=0`,
    [b.id]
  );
  // An old review edited this week is as much a candidate as a new one, so the window runs on the last touch.
  const touched = (rv: { review_name: string; create_time: string }) => activity.get(rv.review_name) ?? new Date(rv.create_time).getTime();
  const cutoff = Date.now() - MATCH_LOOKBACK_DAYS * 86400_000;
  const pending = unlinked.filter((rv) => touched(rv) >= cutoff).sort((x, y) => touched(x) - touched(y));
  let n = 0;
  for (const rv of pending) {
    // Already linked by name to someone (any status)? Then it is not a mystery, just an old row.
    const named = await all<{ name: string }>(
      "SELECT c.name FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.business_id=? AND r.status='reviewed'",
      [b.id]
    );
    if (named.some((x) => namesMatch(x.name, rv.reviewer_name))) {
      await run("UPDATE reviews SET match_checked=1 WHERE id=?", [rv.id]);
      continue;
    }
    const at = touched(rv);
    const open = await all<{ id: number; name: string; sent_at: string; rated_at: string; stars: number; status: string }>(
      `SELECT r.id, c.name, r.sent_at, r.rated_at, r.stars, r.status FROM requests r JOIN customers c ON c.id=r.customer_id
       WHERE r.business_id=? AND r.status IN ('sent','opened') AND r.sent_at != '' AND r.sent_at <= ? AND r.sent_at >= datetime(?, ?)`,
      [b.id, sqlUtc(at), sqlUtc(at), `-${MATCH_LOOKBACK_DAYS} days`]
    );
    const cands: MatchCandidate[] = open.map((r) => {
      const rated = r.rated_at ? new Date(r.rated_at.replace(" ", "T") + "Z").getTime() : null;
      const mins = rated === null ? null : Math.round((at - rated) / 60000);
      return { id: r.id, name: r.name, minutesBefore: mins !== null && mins >= -2 ? mins : null, stars: r.stars };
    });
    let hit: number | null = null;
    let how = "";
    // One person rated well within the window and nobody else did: that is them.
    const close = cands.filter((c) => c.minutesBefore !== null && c.minutesBefore <= MATCH_WINDOW_MIN && c.stars >= GOOD);
    if (close.length === 1 && rv.star_rating >= GOOD) {
      hit = close[0].id;
      how = `tapped ${close[0].minutesBefore} min before the review`;
    } else if (cands.length && aiConfigured()) {
      try {
        const ans = await matchReviewer(rv.reviewer_name, cands);
        if (ans.id !== null) {
          hit = ans.id;
          how = ans.why || "Claude matched the name";
        }
      } catch (err) {
        console.error("matchReviewer", err instanceof Error ? err.message : err);
        continue; // try again next hour rather than marking it checked
      }
    }
    await run("UPDATE reviews SET match_checked=1 WHERE id=?", [rv.id]);
    if (hit === null) continue;
    const c = cands.find((x) => x.id === hit)!;
    await run("UPDATE requests SET status='reviewed', reviewed_at=datetime('now'), next_at='', stop_reason='reviewed' WHERE id=? AND status != 'reviewed'", [hit]);
    await run("UPDATE reviews SET request_id=? WHERE id=?", [hit, rv.id]);
    await logEvent(b.id, "reviewed", `${c.name || "A customer"} left ${rv.star_rating} stars as "${rv.reviewer_name || "Anonymous"}" (${how})`);
    n++;
  }
  return n;
}

function sqlUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Manual-mode businesses: write the reply with Claude as soon as the review lands, store it as
 * the draft, and let a person post it from the Reviews tab. Each review is drafted once.
 */
export async function predraftReplies(b: Business, limit = 10): Promise<number> {
  if (!aiConfigured()) return 0;
  const pending = await all<StoredReview>(
    "SELECT * FROM reviews WHERE business_id=? AND reply_comment='' AND draft_reply='' AND review_name NOT LIKE 'accounts/demo/%' ORDER BY create_time DESC LIMIT ?",
    [b.id, limit]
  );
  let n = 0;
  for (const r of pending) {
    try {
      const text = await draftReviewReply(b, r);
      if (!text) continue;
      await run("UPDATE reviews SET draft_reply=? WHERE id=? AND reply_comment=''", [text, r.id]);
      await logEvent(b.id, "drafted", `Reply to ${r.reviewer_name || "a review"} (${r.star_rating}★) is drafted and waiting in Reviews`);
      n++;
    } catch (err) {
      console.error("predraft", err instanceof Error ? err.message : err);
    }
  }
  return n;
}

/** Draft with Claude and post to Google for every stored review that still has no reply. */
export async function autoReply(b: Business, limit = 10): Promise<number> {
  if (!aiConfigured() || !gbpConfigured() || !b.gbp_location_id) return 0;
  const pending = await all<StoredReview>(
    "SELECT * FROM reviews WHERE business_id=? AND reply_comment='' ORDER BY create_time DESC LIMIT ?",
    [b.id, limit]
  );
  let n = 0;
  for (const r of pending) {
    try {
      const text = r.draft_reply || (await draftReviewReply(b, r));
      if (!text) continue;
      await replyToReview(r.review_name, text);
      await run("UPDATE reviews SET reply_comment=?, reply_time=datetime('now'), draft_reply='' WHERE id=?", [text, r.id]);
      await logEvent(b.id, "replied", `Auto-replied to ${r.reviewer_name || "a review"} (${r.star_rating}★)`);
      n++;
    } catch (err) {
      await logEvent(b.id, "reply_failed", `${r.reviewer_name || "a review"}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }
  return n;
}

export async function syncAllReviews(): Promise<Record<string, unknown>> {
  const linked = await all<Business>("SELECT * FROM businesses WHERE gbp_location_id != '' AND status NOT IN ('cancelled')");
  const out: Record<string, unknown> = {};
  for (const b of linked) {
    try {
      out[b.slug] = await syncBusinessReviews(b);
    } catch (err) {
      out[b.slug] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}
