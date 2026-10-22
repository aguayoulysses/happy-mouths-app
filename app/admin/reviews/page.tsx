// Reviews: every Google review that has come in, per client, and whether we answered it.
// Auto-reply answers within the hour of the sync, so this is a tracker, not a queue.
// A review still unanswered after two hours is the only thing here that needs a person.

import Link from "next/link";
import { redirect } from "next/navigation";
import { all } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { gbpConfigured } from "@/lib/gbp";
import { clientHealth, REVIEW_DROUGHT_DAYS } from "@/lib/health";
import { tr } from "@/lib/i18n-server";
import type { T } from "@/lib/i18n";
import { draftReplyAction, postReplyAction } from "./actions";

export const dynamic = "force-dynamic";

type R = {
  id: number; business_id: number; business: string; star_rating: number; comment: string; reviewer_name: string; create_time: string;
  reply_comment: string; reply_time: string; draft_reply: string; created_at: string; customer: string | null;
};

const days = (iso: string) => Math.floor((Date.now() - new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime()) / 86400e3);
const agoT = (t: T, iso: string) => { const d = days(iso); return d <= 0 ? t("today") : d === 1 ? t("yesterday") : t("{n} days ago", { n: d }); };
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

export default async function AdminReviews({ searchParams }: { searchParams: Promise<{ business?: string; msg?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await tr();
  const ago = (iso: string) => agoT(t, iso);
  const { business, msg } = await searchParams;
  const bid = business ? Number(business) : 0;
  const [clients, rows] = await Promise.all([
    clientHealth(),
    all<R>(
      `SELECT r.id, r.business_id, b.name AS business, r.star_rating, r.comment, r.reviewer_name, r.create_time, r.reply_comment, r.reply_time, r.draft_reply, r.created_at,
              (SELECT c.name FROM requests q JOIN customers c ON c.id=q.customer_id WHERE q.id=r.request_id) AS customer
       FROM reviews r JOIN businesses b ON b.id=r.business_id
       WHERE r.review_name NOT LIKE 'accounts/demo/%' ${bid ? "AND r.business_id=?" : ""}
       ORDER BY r.create_time DESC LIMIT 200`,
      bid ? [bid] : []
    ),
  ]);
  const live = clients.filter((c) => c.health !== "off");
  const shown = bid ? live.filter((c) => c.id === bid) : live;
  const stuck = rows.filter((r) => !r.reply_comment && (Date.now() - new Date(r.created_at.replace(" ", "T") + "Z").getTime()) > 2 * 3600e3);
  const month = rows.filter((r) => days(r.create_time) < 30);
  const replied = rows.filter((r) => r.reply_comment).length;
  const avg = rows.length ? (rows.reduce((n, r) => n + r.star_rating, 0) / rows.length).toFixed(1) : "–";
  const selected = bid ? live.find((c) => c.id === bid) : null;
  const healthLabel = (h: string) => (h === "risk" ? t("At risk") : h === "watch" ? t("Watch") : t("Healthy"));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Reviews")}{selected ? ` · ${selected.name}` : ""}</h1>
          <p className="page-sub">{t("{n} new in 30 days", { n: month.length })} · {rows.length ? t("{n}% answered", { n: Math.round((replied / rows.length) * 100) }) : t("none yet")} · {t("{n} average", { n: avg })}</p>
        </div>
        {selected && <Link href={`/admin/${selected.id}`} className="obtn">{t("Open client")}</Link>}
      </div>
      {msg && <p className="notice">{t(msg)}</p>}
      {!gbpConfigured() && <p className="notice">{t("Google credentials are not set in this environment, so replies cannot post.")}</p>}

      <div className="stats">
        <div className="stat"><div className="stat-num">{month.length}</div><div className="stat-label">{t("New reviews, 30 days")}</div><div className="stat-note">{selected ? t("this client") : t.n(live.length, "across {n} live client", "across {n} live clients")}</div></div>
        <div className="stat"><div className={`stat-num ${stuck.length ? "bad" : ""}`}>{stuck.length}</div><div className="stat-label">{t("Unanswered")}</div><div className="stat-note">{stuck.length ? t("older than 2 hours, needs a person") : t("auto-reply is keeping up")}</div></div>
        <div className="stat"><div className={`stat-num ${shown.some((c) => c.reviews_total && days(c.last_review_at) >= REVIEW_DROUGHT_DAYS) ? "bad" : ""}`}>{shown.filter((c) => !c.reviews_total || days(c.last_review_at) >= REVIEW_DROUGHT_DAYS).length}</div><div className="stat-label">{t("Clients quiet {n}+ days", { n: REVIEW_DROUGHT_DAYS })}</div><div className="stat-note">{t("no new review in a month, we get a text")}</div></div>
        <div className="stat"><div className="stat-num">{avg}</div><div className="stat-label">{t("Average stars")}</div><div className="stat-note">{t.n(rows.length, "{n} review on record", "{n} reviews on record")}</div></div>
      </div>

      {!bid && (
        <>
          <div className="section-label">{t("Per client")} <span>{t("last review first")}</span></div>
          <div className="table-box">
            <table>
              <thead><tr>{["Client", "Last review", "30 days", "All time", "Asked, 30 days", "Unanswered", "Health"].map((h) => <th key={h}>{t(h)}</th>)}</tr></thead>
              <tbody>
                {live
                  .slice()
                  .sort((a, b) => (b.last_review_at || "").localeCompare(a.last_review_at || ""))
                  .map((c) => {
                    const quiet = c.reviews_total ? days(c.last_review_at) : null;
                    const drought = quiet === null || quiet >= REVIEW_DROUGHT_DAYS;
                    return (
                      <tr key={c.id}>
                        <td><Link href={`/admin/reviews?business=${c.id}`} className="client-name">{c.name}</Link></td>
                        <td className={drought ? "bad" : quiet !== null && quiet >= 21 ? "muted" : ""}>{quiet === null ? t("never") : ago(c.last_review_at)}</td>
                        <td className="num">{c.reviews_30d}</td>
                        <td className="num">{c.reviews_total}</td>
                        <td className="num">{c.sent_30d}</td>
                        <td className={`num ${c.reply_stuck ? "bad" : "muted"}`}>{c.reply_stuck}</td>
                        <td><span className={`badge ${c.health}`}><span className="dot" />{healthLabel(c.health)}</span></td>
                      </tr>
                    );
                  })}
                {!live.length && <tr><td colSpan={7} className="empty">{t("No live clients.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-label">
        {bid ? t("Every review") : t("Latest reviews")} <span>{bid && <Link href="/admin/reviews" style={{ color: "var(--accent)" }}>{t("All clients")}</Link>}</span>
      </div>
      <div className="list-box">
        {!rows.length && <p className="empty">{t("No reviews yet.")}</p>}
        {rows.map((r) => {
          const open = !r.reply_comment;
          const late = stuck.includes(r);
          return (
            <div key={r.id} className={`attn-row ${late ? "red" : ""}`} style={{ display: "block" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 12px" }}>
                <span style={{ color: "var(--accent)" }}>{stars(r.star_rating)}</span>
                <span className="attn-name">{r.reviewer_name || t("Anonymous")}</span>
                {!bid && <Link href={`/admin/reviews?business=${r.business_id}`} className="muted" style={{ fontSize: "0.82rem" }}>{r.business}</Link>}
                <span className="muted" style={{ fontSize: "0.82rem" }}>{ago(r.create_time)} · {r.create_time.slice(0, 10)}</span>
                <span className="muted" style={{ fontSize: "0.82rem" }}>{r.customer ? t("from our text to {name}", { name: r.customer }) : t("organic")}</span>
                <span className={`badge ${open ? (late ? "risk" : "watch") : "healthy"}`} style={{ marginLeft: "auto" }}><span className="dot" />{open ? (late ? t("Unanswered") : t("Reply coming")) : t("Replied {when}", { when: ago(r.reply_time) })}</span>
              </div>
              {r.comment && <p style={{ margin: "8px 0 0", fontSize: "0.92rem", lineHeight: 1.5 }}>{r.comment}</p>}
              {r.reply_comment && <p className="muted" style={{ margin: "8px 0 0", paddingLeft: 12, borderLeft: "2px solid var(--hairline)", fontSize: "0.86rem", lineHeight: 1.5 }}>{r.reply_comment}</p>}
              {open && late && (
                <form action={postReplyAction} style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="business" value={bid || ""} />
                  <textarea name="comment" defaultValue={r.draft_reply} rows={3} className="field" placeholder={t("Reply as the business")} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="obtn" disabled={!gbpConfigured()}>{t("Post to Google")}</button>
                    <button formAction={draftReplyAction} className="obtn" disabled={!aiConfigured()}>{r.draft_reply ? t("Draft again") : t("Draft with Claude")}</button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
