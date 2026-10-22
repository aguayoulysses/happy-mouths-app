import { useEffect, useState } from "react";
import { api, post, del } from "../lib/api";
import { Group, Row, Skeleton, Status, EmptyRow, Masthead } from "../ui/bits";
import { Icon } from "../ui/icons";
import { Sheet } from "../ui/Sheet";
import { prettyPhone, timeAgo, shortDate } from "../lib/format";
import { useToast } from "../ui/Toast";
import { tap, success } from "../lib/native";

type C = { id: number; name: string; phone: string; email: string; source: string; created_at: string; last_status: string | null; last_send_at: string | null; requests_sent: number; opted_out: number; blocked: number; last_next_at: string | null; last_stars?: number | null; feedback?: string | null };
type B = { phone: string; name: string; reason: string; created_at: string };

const SOURCE: Record<string, string> = { manual: "Added by hand", csv: "From a list", square: "From Square", stripe: "From Stripe", calendly: "From Calendly", acuity: "From Acuity", generic: "From a webhook" };

export function Customers({ onAdd, onImport, refreshKey }: { onAdd: () => void; onImport: () => void; refreshKey: number }) {
  const [rows, setRows] = useState<C[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<C | null>(null);
  const [filter, setFilter] = useState<"all" | "queued" | "sent" | "reviewed" | "blocked">("all");
  const [blocked, setBlocked] = useState<B[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [nb, setNb] = useState({ name: "", phone: "" });
  const toast = useToast();
  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "queued", label: "Scheduled" },
    { key: "sent", label: "Sent" },
    { key: "reviewed", label: "Reviewed" },
    { key: "blocked", label: "Do not contact" },
  ];
  const visible = rows?.filter((c) => {
    if (filter === "all") return true;
    if (filter === "sent") return ["sent", "opened"].includes(c.last_status ?? "");
    return c.last_status === filter;
  });

  async function load(query = q) {
    const r = await api<{ customers: C[] }>(`/api/v1/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    setRows(r.customers);
    api<{ blocked: B[] }>("/api/v1/dnc").then((d) => setBlocked(d.blocked)).catch(() => {});
  }
  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, refreshKey]);

  // Back on the normal drip: same path as Quick Add, never an instant send.
  async function schedule(c: C) {
    tap();
    try {
      await post("/api/v1/customers", { name: c.name, phone: c.phone });
      success();
      toast(`Scheduled for ${c.name || prettyPhone(c.phone)}`);
      setSel(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't schedule");
    }
  }
  async function skipOne(c: C) {
    tap();
    try {
      await post(`/api/v1/customers/${c.id}/cancel`);
      toast(`Stopped. ${c.name || "They"} won't get this one`);
      setSel(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't stop it");
    }
  }
  async function blockCustomer(c: C) {
    tap();
    try {
      await post("/api/v1/dnc", { customer_id: c.id });
      success();
      toast(`${c.name || "They"} will never get a review text`);
      setSel(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save");
    }
  }
  async function allow(phone: string) {
    tap();
    await del("/api/v1/dnc", { phone });
    toast("Allowed again");
    setSel(null);
    load();
  }
  async function addNumber() {
    tap();
    try {
      await post("/api/v1/dnc", nb);
      success();
      toast("Added to do not contact");
      setNb({ name: "", phone: "" });
      setAdding(false);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save");
    }
  }
  async function remove(c: C) {
    tap();
    await del(`/api/v1/customers/${c.id}`);
    toast("Removed");
    setSel(null);
    load();
  }

  return (
    <>
      <Masthead />
      <div className="mt-5 flex items-center justify-between gap-3 md:mt-3">
        <h1 className="h-page">Customers</h1>
        <div className="flex gap-2">
          <button type="button" onClick={onImport} className="btn btn-ghost btn-sm">Add a list</button>
          <button type="button" onClick={onAdd} className="btn btn-ink btn-sm hidden md:inline-flex">Add customer</button>
        </div>
      </div>
      <div className="relative mt-5">
        <Icon.search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8e8e93]" width={18} height={18} />
        <input className="field search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
      </div>
      <div className="chips mt-3">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => { tap(); setFilter(f.key); }} className={`chip ${filter === f.key ? "on" : ""}`}>{f.label}</button>
        ))}
      </div>

      {filter === "blocked" && (
        <>
          <p className="mt-4 px-1 text-[13px] leading-snug text-ink-soft">People on this list never get a review text, even if your booking or payment system sends them to us again.</p>
          <Group className="mt-3">
            {blocked && blocked.length === 0 && <EmptyRow title="No one here yet" body="Had a rough visit with someone? Add them and we will leave them alone." />}
            {blocked?.map((x) => (
              <Row key={x.phone}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{x.name || prettyPhone(x.phone)}</p>
                  <p className="truncate text-[13px] text-ink-mute">{x.name ? `${prettyPhone(x.phone)} · ` : ""}added {shortDate(x.created_at)}</p>
                </div>
                <button type="button" onClick={() => allow(x.phone)} className="btn btn-soft btn-sm">Allow again</button>
              </Row>
            ))}
          </Group>
          <button type="button" onClick={() => { tap(); setAdding(true); }} className="btn btn-ghost mt-3 h-12 w-full">Add a number</button>
        </>
      )}

      {filter !== "blocked" && <Group className="mt-3">
        {!rows && [0, 1, 2, 3, 4].map((i) => (
          <Row key={i}><div className="flex-1"><Skeleton h={14} w="40%" /><Skeleton h={12} w="25%" className="mt-2" /></div></Row>
        ))}
        {visible && visible.length === 0 && <EmptyRow title={q || filter !== "all" ? "No one matches that" : "No customers yet"} body={q || filter !== "all" ? undefined : "Add them one at a time after a visit, or bring a whole list."} />}
        {visible?.map((c) => (
          <Row key={c.id} onClick={() => { tap(); setSel(c); }}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{c.name || prettyPhone(c.phone)}</p>
              <p className="truncate text-[13px] text-ink-mute">{c.name ? `${prettyPhone(c.phone)} · ` : ""}{shortDate(c.created_at)}</p>
            </div>
            {c.opted_out ? <span className="text-[13px] font-semibold text-ink-mute">Opted out</span> : c.blocked ? <span className="text-[13px] font-semibold text-ink-mute">Do not contact</span> : c.last_status ? <Status status={c.last_status} /> : null}
          </Row>
        ))}
      </Group>}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Do not contact">
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">Add them before they come through your booking system and no text ever goes out.</p>
        <label className="label mt-4">Cell number</label>
        <input className="field" type="tel" inputMode="tel" value={nb.phone} onChange={(e) => setNb({ ...nb, phone: e.target.value })} placeholder="(714) 555-1234" />
        <label className="label mt-3">Name (optional)</label>
        <input className="field" value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
        <div className="mt-4 grid gap-2">
          <button type="button" onClick={addNumber} disabled={!nb.phone.trim()} className="btn btn-ink h-12">Never text this number</button>
        </div>
      </Sheet>

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.name || (sel ? prettyPhone(sel.phone) : "")}>
        {sel && (
          <div className="mt-1">
            <p className="text-[14px] text-ink-soft">{prettyPhone(sel.phone)}{sel.email ? ` · ${sel.email}` : ""}</p>
            <p className="text-[14px] text-ink-soft">{SOURCE[sel.source] ?? sel.source}, {shortDate(sel.created_at)}</p>
            <div className="mt-4 text-[14px]">
              {sel.opted_out ? (
                <p className="font-semibold">This customer texted STOP. We won&rsquo;t message them.</p>
              ) : sel.blocked ? (
                <p className="font-semibold">On your do-not-contact list. No review texts go to them.</p>
              ) : sel.last_status ? (
                <p><Status status={sel.last_status} />{sel.last_status === "queued" && sel.last_send_at ? <span className="text-ink-soft">, sends {timeAgo(sel.last_send_at)}</span> : null}</p>
              ) : (
                <p className="text-ink-soft">No request yet.</p>
              )}
              {sel.requests_sent > 0 && <p className="mt-1 text-ink-soft">{sel.requests_sent} request{sel.requests_sent === 1 ? "" : "s"} sent in total.</p>}
              {!!sel.last_stars && (
                <div className={`mt-3 rounded-2xl border border-line p-3 ${sel.last_stars <= 3 ? "bg-cherry-soft" : "bg-sun-soft"}`}>
                  <p className="font-semibold">{"★".repeat(sel.last_stars)}{"☆".repeat(5 - sel.last_stars)} {sel.last_stars <= 3 ? "Kept private, not on Google" : "Sent on to Google"}</p>
                  {sel.feedback ? <p className="mt-1 leading-relaxed text-ink-soft">&ldquo;{sel.feedback}&rdquo;</p> : sel.last_stars <= 3 ? <p className="mt-1 text-ink-soft">No note yet. Worth a call.</p> : null}
                </div>
              )}
            </div>
            <div className="mt-5 grid gap-2">
              {!sel.opted_out && !sel.blocked && !sel.last_next_at && !["sent", "opened"].includes(sel.last_status ?? "") && <button type="button" onClick={() => schedule(sel)} className="btn btn-ink h-12">Schedule a review text</button>}
              {!sel.opted_out && !sel.blocked && !!sel.last_next_at && <button type="button" onClick={() => skipOne(sel)} className="btn btn-ghost h-12">{sel.last_status === "queued" ? "Don't send this one" : "Stop the follow-ups"}</button>}
              {!sel.opted_out && (sel.blocked
                ? <button type="button" onClick={() => allow(sel.phone)} className="btn btn-ghost h-12">Allow review texts again</button>
                : <button type="button" onClick={() => blockCustomer(sel)} className="btn btn-ghost h-12">Never text this customer</button>)}
              <a href={`sms:${sel.phone}`} className="btn btn-ghost h-12">Text them yourself</a>
              <button type="button" onClick={() => remove(sel)} className="btn btn-soft h-12 text-cherry">Remove customer</button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
