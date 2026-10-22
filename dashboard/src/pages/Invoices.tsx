import { useCallback, useEffect, useState } from "react";
import { api, post } from "../lib/api";
import { Group, Row, Masthead } from "../ui/bits";
import { Icon } from "../ui/icons";
import { prettyPhone, shortDate } from "../lib/format";
import { tap, success } from "../lib/native";
import { Sheet } from "../ui/Sheet";
import { Preferences } from "@capacitor/preferences";

const AI_OK = "hm_ai_ok";

type DocData = { customer_name: string; customer_phone: string; total: number; balance_due: number; amount_paid: number };
type Doc = { id: number; kind: "receipt" | "invoice" | "quote"; language: string; url: string; data: DocData; created_at: string };

const LABEL: Record<string, { en: string; es: string }> = { receipt: { en: "Receipt", es: "Recibo" }, invoice: { en: "Invoice", es: "Factura" }, quote: { en: "Quote", es: "Cotización" } };
const label = (d: Doc) => LABEL[d.kind]?.[d.language === "es" ? "es" : "en"] ?? d.kind;
const money = (n: number) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function BackBar({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={() => { tap(); onClick(); }} className="-ml-1.5 mt-4 flex items-center gap-0.5 text-[15px] font-semibold text-ink-soft md:mt-2">
      <Icon.back width={20} height={20} strokeWidth={2.3} />{label}
    </button>
  );
}

/** Say what the job was; get a receipt, invoice or quote the customer can open. */
export function Invoices({ businessName, onBack }: { businessName: string; onBack: () => void }) {
  const [dictation, setDictation] = useState("");
  const [kind, setKind] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [current, setCurrent] = useState<Doc | null>(null);
  const [ask, setAsk] = useState(false);

  const refresh = useCallback(() => {
    api<{ documents: Doc[] }>("/api/v1/documents").then((r) => setDocs(r.documents)).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  // The write-up is drafted by an AI service, so the first time we say so and ask.
  async function start() {
    tap();
    const { value } = await Preferences.get({ key: AI_OK });
    if (value === "yes") return create();
    setAsk(true);
  }

  async function allow() {
    await Preferences.set({ key: AI_OK, value: "yes" });
    setAsk(false);
    create();
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const r = await post<{ document: Doc }>("/api/v1/documents", { dictation, kind });
      success();
      setCurrent(r.document);
      setDictation("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That one did not go through.");
    } finally {
      setBusy(false);
    }
  }

  if (current) return <DocDetail doc={current} businessName={businessName} onBack={() => setCurrent(null)} />;

  return (
    <>
      <Masthead />
      <BackBar label="Home" onClick={onBack} />
      <h1 className="h-page mt-2">Invoices</h1>
      <p className="mt-2 text-[15px] leading-snug text-ink-soft">Say what the job was.</p>
      {error && <p className="mt-3 text-[14px] font-semibold text-cherry">{error}</p>}
      <textarea className="field mt-4" style={{ height: "auto" }} rows={5} value={dictation} onChange={(e) => setDictation(e.target.value)} placeholder="Mowed the lawn and trimmed two trees for Maria, 80 for the mowing, 120 for the trees, she paid cash" />
      <div className="chips mt-3">
        {[["auto", "Decide for me"], ["receipt", "Receipt"], ["invoice", "Invoice"], ["quote", "Quote"]].map(([k, l]) => (
          <button key={k} type="button" className={`chip ${kind === k ? "on" : ""}`} onClick={() => { tap(); setKind(k); }}>{l}</button>
        ))}
      </div>
      <button type="button" onClick={start} disabled={busy || dictation.trim().length < 10} className="btn btn-sun mt-3 h-13 w-full text-[16px]">{busy ? "Writing it up…" : "Create"}</button>

      <Sheet open={ask} onClose={() => setAsk(false)} title="Written with AI">
        <p className="text-[15px] leading-relaxed text-ink-soft">To write this up, what you typed is sent to Claude, an AI service made by Anthropic. Nothing else from your account is sent, and it is not used to train AI. Check the amounts before you send it to a customer.</p>
        <div className="mt-5 grid gap-2">
          <button type="button" onClick={allow} className="btn btn-sun h-12">Allow and create</button>
          <button type="button" onClick={() => setAsk(false)} className="btn btn-ghost h-12">Not now</button>
        </div>
      </Sheet>

      {docs.length > 0 && (
        <>
          <h2 className="h-section mt-8">Recent</h2>
          <Group>
            {docs.map((d) => (
              <Row key={d.id} onClick={() => { tap(); setCurrent(d); }}>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[15px] font-semibold">{d.data.customer_name || label(d)}</p>
                  <p className="text-[13px] text-ink-mute">{label(d)} · {shortDate(d.created_at)}</p>
                </div>
                <span className="text-[15px] font-bold">{money(d.data.total)}</span>
                <Icon.chevron className="text-ink-mute" width={18} height={18} />
              </Row>
            ))}
          </Group>
        </>
      )}
    </>
  );
}

type Contact = { id: number; name: string; phone: string };

/** Pick one of the business's existing customers instead of typing the number again. */
function ContactPicker({ onPick }: { onPick: (c: Contact) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ customers: Contact[] }>(`/api/v1/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
      .then((r) => { if (live) setRows(r.customers.filter((c) => c.phone).slice(0, 8)); })
      .catch(() => {});
    return () => { live = false; };
  }, [q, open]);
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost h-11 w-full text-[15px]">Choose from my customers</button>;
  }
  return (
    <div className="rounded-2xl border border-line p-3">
      <input className="field" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or number" />
      <ul className="mt-2 divide-y divide-line">
        {rows.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => { tap(); onPick(c); setOpen(false); }} className="flex w-full items-center gap-3 py-2.5 text-left">
              <span className="flex-1 text-[15px] font-semibold">{c.name || "No name"}</span>
              <span className="text-[13px] text-ink-mute">{prettyPhone(c.phone)}</span>
            </button>
          </li>
        ))}
        {!rows.length && <li className="py-2 text-[14px] text-ink-mute">{q ? "Nobody matches." : "No customers yet."}</li>}
      </ul>
      <button type="button" onClick={() => setOpen(false)} className="mt-2 text-[13px] font-bold text-ink-mute">Cancel</button>
    </div>
  );
}

function DocDetail({ doc, businessName, onBack }: { doc: Doc; businessName: string; onBack: () => void }) {
  const [phone, setPhone] = useState(doc.data.customer_phone ?? "");
  const [name, setName] = useState(doc.data.customer_name ?? "");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const message = `Hi! Here is your ${(LABEL[doc.kind]?.en ?? doc.kind).toLowerCase()} from ${businessName}: ${doc.url}`;

  async function send() {
    setSending(true);
    setNote(null);
    try {
      const r = await post<{ to: string }>(`/api/v1/documents/${doc.id}/send`, { phone, name });
      success();
      setNote({ ok: true, text: `Sent to ${r.to || prettyPhone(phone)} from your business number.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Could not send." });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Masthead />
      <BackBar label="Invoices" onClick={onBack} />
      <h1 className="h-page mt-2">{label(doc)}</h1>
      <div className="group hero mt-5 px-5 py-5">
        <p className="text-[14px] font-medium text-ink-soft">{doc.data.customer_name || "Your customer"}</p>
        <p className="hero-num mt-1" style={{ fontSize: 52 }}>{money(doc.data.total)}</p>
        {doc.data.amount_paid > 0 && doc.data.balance_due > 0 && <p className="mt-2 text-[14px] text-ink-soft">{money(doc.data.amount_paid)} paid, <span className="font-semibold text-ink">{money(doc.data.balance_due)} due</span></p>}
      </div>
      <Group className="mt-3">
        <a className="row" href={doc.url} target="_blank" rel="noreferrer"><span className="flex-1 text-[15px] font-semibold">See what the customer sees</span><Icon.external width={18} height={18} className="text-ink-mute" /></a>
      </Group>

      <h2 className="h-section mt-7">Text it to them</h2>
      <section className="group p-5">
        <ContactPicker onPick={(c) => { setPhone(c.phone); if (c.name) setName(c.name); setNote(null); }} />
        <label className="label mt-4">Their cell</label>
        <input className="field" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(714) 555-1234" />
        <label className="label mt-3">Their name</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        {note && <p className={`mt-3 text-[14px] font-semibold ${note.ok ? "text-leaf" : "text-cherry"}`}>{note.text}</p>}
        <button type="button" onClick={send} disabled={sending || phone.replace(/\D/g, "").length < 10} className="btn btn-sun mt-4 h-12 w-full">{sending ? "Sending…" : "Send from my business number"}</button>
      </section>

      <h2 className="h-section mt-7">Other ways to send</h2>
      <Group>
        <a className="row" href={`sms:?&body=${encodeURIComponent(message)}`}><span className="flex-1 text-[15px] font-semibold">From my own phone</span><Icon.chevron width={18} height={18} className="text-ink-mute" /></a>
        <a className="row" href={`mailto:?subject=${encodeURIComponent(`${label(doc)} · ${businessName}`)}&body=${encodeURIComponent(message)}`}><span className="flex-1 text-[15px] font-semibold">By email</span><Icon.chevron width={18} height={18} className="text-ink-mute" /></a>
        {typeof navigator.share === "function" && (
          <button type="button" className="row" onClick={() => navigator.share({ title: label(doc), text: message, url: doc.url }).catch(() => {})}><span className="flex-1 text-left text-[15px] font-semibold">Share…</span><Icon.chevron width={18} height={18} className="text-ink-mute" /></button>
        )}
      </Group>
    </>
  );
}
