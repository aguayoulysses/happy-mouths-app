import { useEffect, useState } from "react";
import { api, post } from "../lib/api";
import { Group, Section, Row, Ledger, Stars, Status, Skeleton, EmptyRow, Masthead } from "../ui/bits";
import { WeekBars, type WeekPoint } from "../ui/WeekBars";
import { Icon } from "../ui/icons";
import { navigate } from "../lib/router";
import { timeAgo } from "../lib/format";
import { useToast } from "../ui/Toast";
import { tap, success } from "../lib/native";
import { Sheet } from "../ui/Sheet";

type Recent = { id: number; customer_id: number; status: string; name: string; phone: string; send_at: string; sent_at: string; created_at: string; error: string; stop_reason: string };
export type Dashboard = {
  linked: boolean;
  tracking?: boolean;
  requests: { sent: number; opened: number; reviewed: number; queued: number; failed: number; conversion: number };
  month: { sent: number; opened: number; reviewed: number };
  reviews: { total: number; last_30_days: number; average: number; unreplied: number } | null;
  weeks: WeekPoint[];
  recent: Recent[];
  google?: { views: number; views_prev: number; calls: number; calls_prev: number; through: string } | null;
  line?: { total: number; answered: number; missed: number; texted_back: number; outgoing: number } | null;
};

const STOPPED: Record<string, string> = { "cancelled by owner": "You stopped this one", "do not contact": "On your do-not-contact list", "opted out": "They texted STOP", "customer removed": "Customer removed" };

export function Home({ business, onAdd, onImport, refreshKey, onStats }: { business: { name: string; owner_name: string; review_link: string; delay_minutes: number; features?: { invoices: boolean; photos: boolean } }; onAdd: () => void; onImport: () => void; refreshKey: number; onStats: (d: Dashboard) => void }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [err, setErr] = useState("");
  const toast = useToast();
  const [hold, setHold] = useState<Recent | null>(null);

  async function load() {
    try {
      const data = await api<Dashboard>("/api/v1/dashboard");
      setD(data);
      onStats(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load");
    }
  }
  useEffect(() => {
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function stop(r: Recent, forever: boolean) {
    tap();
    try {
      if (forever) await post("/api/v1/dnc", { customer_id: r.customer_id });
      else await post(`/api/v1/customers/${r.customer_id}/cancel`);
      success();
      toast(forever ? `${r.name || "They"} will never get a review text` : `Stopped. ${r.name || "They"} won't get this one`);
      setHold(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't stop it");
    }
  }

  const loading = !d;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const thisMonth = d?.month.sent ?? 0;
  const reviewedMonth = d?.month.reviewed ?? 0;

  return (
    <>
      <Masthead />
      <div className="settle mt-5 flex items-end justify-between gap-3 md:mt-3">
        <div>
          <p className="text-[14px] font-medium text-ink-soft">{today}</p>
          <h1 className="h-page mt-0.5">{business.name}</h1>
        </div>
        <button type="button" onClick={onAdd} className="btn btn-ink hidden md:inline-flex"><Icon.plus width={17} height={17} />Add customer</button>
      </div>

      {err && <p className="mt-4 text-[14px] font-semibold text-cherry">{err}</p>}

      {/* The hero: one thing, set big. */}
      <div className="settle settle-2 group hero relative mt-6 overflow-hidden px-5 pb-5 pt-6">
        {loading ? (
          <><Skeleton h={64} w={140} /><Skeleton h={16} w={220} className="mt-3" /></>
        ) : d.reviews ? (
          <>
            <div className="plan-sheen" aria-hidden="true" />
            <p className="text-[14px] font-medium text-ink-soft">Google rating</p>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="hero-num tabular-nums">{d.reviews.average ? <CountUp to={d.reviews.average} decimals={1} /> : "—"}</span>
              <span className="stars" style={{ fontSize: 22 }} aria-label={`${d.reviews.average} stars`}>
                {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`star-pop ${i < Math.round(d.reviews!.average) ? "" : "off"}`} style={{ animationDelay: `${420 + i * 90}ms` }}>★</span>)}
              </span>
            </div>
            <p className="mt-3 text-[15px] text-ink-soft">
              <span className="font-semibold text-ink">{d.reviews.total} reviews</span>, {d.reviews.last_30_days} in the last 30 days.
            </p>
          </>
        ) : (
          <>
            <div className="plan-sheen" aria-hidden="true" />
            <div className="flex items-baseline gap-3">
              <span className="hero-num tabular-nums"><CountUp to={reviewedMonth} /></span>
              <span className="text-[17px] font-semibold text-ink-soft">reviews this month</span>
            </div>
            <p className="mt-3 text-[15px] text-ink-soft">from <span className="font-semibold text-ink">{thisMonth} requests</span> sent in the last four weeks.</p>
          </>
        )}
      </div>

      <Section title="This month" className="settle settle-3">
        <Group>
          {loading ? (
            [0, 1, 2, 3].map((i) => <div key={i} className="ledger"><Skeleton h={14} w={120} /><Skeleton h={18} w={40} /></div>)
          ) : (
            <>
              <Ledger label="Requests sent" value={d.month.sent} note={d.requests.queued ? `${d.requests.queued} scheduled` : undefined} />
              {d.tracking && <Ledger label="Tapped the link" value={d.month.opened} note={d.month.sent ? `${Math.round((d.month.opened / d.month.sent) * 100)}%` : undefined} />}
              <Ledger label="Left a review" value={d.month.reviewed} note={d.month.sent ? `${Math.round((d.month.reviewed / d.month.sent) * 100)}%` : undefined} />
            </>
          )}
        </Group>
      </Section>

      {d?.google && (
        <Section title="From Google" aside="Last 30 days" className="settle settle-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Trend label="Saw you on Google" now={d.google.views} before={d.google.views_prev} />
            <Trend label="Tapped Call" now={d.google.calls} before={d.google.calls_prev} />
          </div>
        </Section>
      )}

      {d?.line && d.line.total + d.line.outgoing > 0 && (
        <Section title="Your business line" aside="Last 30 days" className="settle settle-3">
          <Group>
            <Ledger label="Calls from customers" value={d.line.total} />
            <Ledger label="You answered" value={d.line.answered} note={d.line.total ? `${Math.round((d.line.answered / d.line.total) * 100)}%` : undefined} />
            <Ledger label="Missed" value={d.line.missed} note={d.line.texted_back ? `${d.line.texted_back} texted back` : undefined} />
            <Ledger label="Calls you made" value={d.line.outgoing} />
          </Group>
        </Section>
      )}

      {(business.features?.invoices || business.features?.photos) && (
        <Section title="Tools" className="settle settle-3">
          <Group>
            {business.features?.invoices && (
              <Row onClick={() => { tap(); navigate("/invoices"); }}>
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-sun-soft"><Icon.doc width={20} height={20} /></span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[15px] font-semibold">Invoices</p>
                  <p className="truncate text-[13px] text-ink-mute">Receipt, invoice or quote from a few words</p>
                </div>
                <Icon.chevron className="text-ink-mute" width={18} height={18} />
              </Row>
            )}
            {business.features?.photos && (
              <Row onClick={() => { tap(); navigate("/photos"); }}>
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-sun-soft"><Icon.image width={20} height={20} /></span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[15px] font-semibold">Photos</p>
                  <p className="truncate text-[13px] text-ink-mute">Add job photos to your Google profile</p>
                </div>
                <Icon.chevron className="text-ink-mute" width={18} height={18} />
              </Row>
            )}
          </Group>
        </Section>
      )}

      <Section title="Week by week" className="settle settle-3">
        <Group className="px-4 pb-3 pt-4">{loading ? <Skeleton h={150} /> : <WeekBars weeks={d.weeks} />}</Group>
      </Section>

      <Section title="Recent" aside={<button type="button" onClick={() => navigate("/customers")}>All customers</button>} className="settle settle-3">
        <Group>
          {loading && [0, 1, 2].map((i) => (
            <Row key={i}><div className="flex-1"><Skeleton h={14} w="45%" /><Skeleton h={12} w="30%" className="mt-2" /></div></Row>
          ))}
          {!loading && d.recent.length === 0 && (
            <EmptyRow title="No requests yet" body="Add your first customer and the review text goes out on its own.">
              <button type="button" onClick={onAdd} className="btn btn-ink btn-sm">Add a customer</button>
              <button type="button" onClick={onImport} className="btn btn-soft btn-sm">Add a list</button>
            </EmptyRow>
          )}
          {!loading && d.recent.map((r) => (
            <Row key={r.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{r.name || r.phone}</p>
                <p className="truncate text-[13px] text-ink-mute">
                  {r.status === "queued" ? `Sends ${timeAgo(r.send_at)}` : r.status === "failed" ? r.error : r.status === "skipped" && r.stop_reason ? STOPPED[r.stop_reason] ?? r.stop_reason : timeAgo(r.sent_at || r.created_at)}
                </p>
              </div>
              {r.status === "queued" ? (
                <button type="button" onClick={() => { tap(); setHold(r); }} className="btn btn-soft btn-sm">Don&rsquo;t send</button>
              ) : (
                <Status status={r.status} />
              )}
            </Row>
          ))}
        </Group>
      </Section>

      <Sheet open={!!hold} onClose={() => setHold(null)} title={hold ? `Hold the text to ${hold.name || hold.phone}?` : ""}>
        {hold && (
          <>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">Nothing has gone out yet. Skip just this visit, or make sure they never hear from us.</p>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => stop(hold, false)} className="btn btn-ink h-12">Don&rsquo;t send this one</button>
              <button type="button" onClick={() => stop(hold, true)} className="btn btn-ghost h-12">Never text this customer</button>
              <button type="button" onClick={() => setHold(null)} className="btn btn-soft h-12">Keep it scheduled</button>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

/** Counts up to the number once, easing out, the way a score settles. */
function CountUp({ to, decimals = 0 }: { to: number; decimals?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
    const start = performance.now(), dur = 900;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setV(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v.toFixed(decimals)}</>;
}

/** One Google number with how it moved against the 30 days before. */
function Trend({ label, now, before }: { label: string; now: number; before: number }) {
  const diff = now - before;
  const pct = before ? Math.round((Math.abs(diff) / before) * 100) : null;
  return (
    <div className="group px-4 py-4">
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      <p className="mt-1 text-[32px] font-extrabold leading-none tracking-tight tabular-nums" style={{ fontFamily: "var(--font-display)" }}><CountUp to={now} /></p>
      <p className={`mt-2 text-[13px] font-semibold ${diff > 0 ? "text-leaf" : diff < 0 ? "text-cherry" : "text-ink-mute"}`}>
        {diff === 0 ? "Same as before" : `${diff > 0 ? "▲" : "▼"} ${pct !== null ? `${pct}%` : Math.abs(diff)} vs the month before`}
      </p>
    </div>
  );
}
