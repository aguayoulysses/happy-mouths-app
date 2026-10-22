import { useCallback, useEffect, useState } from "react";
import { api, post } from "../lib/api";
import { Sheet } from "../ui/Sheet";
import { Masthead, Group, Row, EmptyRow, Skeleton } from "../ui/bits";
import { Icon } from "../ui/icons";
import { useToast } from "../ui/Toast";
import { prettyPhone, prettyPhoneList, timeAgo } from "../lib/format";
import { tap, success } from "../lib/native";
import { startCall } from "../lib/voice";
import { Threads, Thread, Compose, type ThreadRow } from "./Inbox";

export type Line = { phone_number: string; forward_to: string; ring_seconds: number; missed_call_text: string; in_app_calling: boolean };
type Call = { id: number; direction: "in" | "out"; phone: string; name: string; status: string; duration: number; missed: boolean; texted_back: boolean; created_at: string };

const KEYS: [string, string][] = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]];

function typedPretty(d: string) {
  const n = d.replace(/\D/g, "");
  if (d.startsWith("*") || d.startsWith("#") || n.length > 10 || n.length < 4) return d;
  return n.length <= 6 ? `(${n.slice(0, 3)}) ${n.slice(3)}` : `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const toE164 = (d: string) => {
  const n = d.replace(/\D/g, "");
  return n.length === 10 ? `+1${n}` : n.length === 11 && n.startsWith("1") ? `+${n}` : "";
};

function outcome(c: Call): string {
  if (c.direction === "in") return c.missed ? (c.texted_back ? "Missed, we texted them back" : "Missed") : `Incoming, ${mmss(c.duration)}`;
  if (c.status === "completed" && c.duration > 0) return `Outgoing, ${mmss(c.duration)}`;
  if (c.status === "busy") return "Outgoing, line busy";
  if (c.status === "no-answer" || c.status === "canceled" || c.status === "completed") return "Outgoing, no answer";
  if (c.status === "failed") return "Outgoing, did not connect";
  return "Outgoing";
}

type Feat = { phone: boolean; messages: boolean };

/**
 * The business line. Opens on a list like Messages / Phone do: one Texts | Calls switch, a compose
 * icon in the corner, and a round keypad button. Line settings live in the Settings tab.
 */
export function Phone({ feat, dial, onDialed, openThread, onThreadOpened, onUnread }: { feat: Feat; dial: string | null; onDialed: () => void; openThread: string | null; onThreadOpened: () => void; onUnread: (n: number) => void }) {
  const [line, setLine] = useState<Line | null>(null);
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [jump, setJump] = useState<number | null>(null);
  const [compose, setCompose] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [digits, setDigits] = useState("");
  const [view, setView] = useState<"texts" | "calls">(feat.messages ? "texts" : "calls");

  const load = useCallback(() => {
    if (feat.phone) {
      api<{ line: Line }>("/api/v1/phone").then((r) => setLine(r.line)).catch(() => {});
      api<{ calls: Call[] }>("/api/v1/calls").then((r) => setCalls(r.calls)).catch(() => setCalls((c) => c ?? []));
    }
    if (feat.messages) {
      api<{ threads: ThreadRow[] }>("/api/v1/conversations")
        .then((r) => { setThreads(r.threads); onUnread(r.threads.reduce((n, t) => n + t.unread, 0)); })
        .catch(() => setThreads((t) => t ?? []));
    }
  }, [feat.phone, feat.messages, onUnread]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 20000);
    // The log row for a call lands a moment after it ends.
    const ended = () => setTimeout(load, 1500);
    window.addEventListener("hm:call-ended", ended);
    return () => {
      clearInterval(poll);
      window.removeEventListener("hm:call-ended", ended);
    };
  }, [load]);

  // A tapped "missed call" notification arrives with the number ready to dial.
  useEffect(() => {
    if (!dial) return;
    setDigits(dial.replace(/^\+1/, ""));
    setKeypad(true);
    onDialed();
  }, [dial, onDialed]);

  // A tapped "new text" notification opens that customer's thread.
  useEffect(() => {
    if (!openThread) return;
    setThread(openThread);
    onThreadOpened();
  }, [openThread, onThreadOpened]);

  const unread = threads?.reduce((n, t) => n + t.unread, 0) ?? 0;
  const missed = calls?.filter((c) => c.missed).length ?? 0;
  const both = feat.phone && feat.messages;

  return (
    <>
      <Masthead />
      <div className="settle mt-5 flex items-center justify-between gap-3 md:mt-3">
        <h1 className="h-page">{both ? "Phone" : feat.messages ? "Texts" : "Calls"}</h1>
        {feat.messages && view === "texts" && (
          <button type="button" aria-label="New message" onClick={() => { tap(); setCompose(true); }} className="round-btn"><Icon.compose width={22} height={22} /></button>
        )}
      </div>

      {both && (
        <div className="segmented settle settle-2 mt-4" role="tablist">
          <button type="button" role="tab" aria-selected={view === "texts"} className={view === "texts" ? "on" : ""} onClick={() => { tap(); setView("texts"); }}>Texts{unread > 0 && <span className="seg-count">{unread}</span>}</button>
          <button type="button" role="tab" aria-selected={view === "calls"} className={view === "calls" ? "on" : ""} onClick={() => { tap(); setView("calls"); }}>Calls{missed > 0 && <span className="seg-count">{missed}</span>}</button>
        </div>
      )}

      {view === "texts" && feat.messages && <Threads threads={threads} onOpen={(p, id) => { setJump(id ?? null); setThread(p); }} onCompose={() => setCompose(true)} />}

      {view === "calls" && feat.phone && (
        <Group className="settle settle-3 mt-4">
          {!calls && [0, 1, 2].map((i) => <Row key={i}><div className="flex-1"><Skeleton h={14} w="45%" /><Skeleton h={12} w="30%" className="mt-2" /></div></Row>)}
          {calls && calls.length === 0 && <EmptyRow title="No calls yet" body="Calls to and from your business line show up here. Tap the keypad to call someone." />}
          {calls?.map((c) => {
            const Dir = c.direction === "out" ? Icon.phoneOut : Icon.phoneIn;
            return (
              <Row key={c.id} onClick={() => { tap(); startCall({ phone: c.phone, name: c.name }); }}>
                <Dir width={17} height={17} className={c.missed ? "text-cherry" : "text-ink-mute"} strokeWidth={2.2} />
                <div className="min-w-0 flex-1 text-left">
                  <p className={`truncate text-[16px] font-semibold ${c.missed ? "text-cherry" : ""}`}>{c.name || prettyPhone(c.phone)}</p>
                  <p className="truncate text-[13px] text-ink-mute">{outcome(c)}</p>
                </div>
                <span className="whitespace-nowrap text-[13px] text-ink-mute">{timeAgo(c.created_at)}</span>
              </Row>
            );
          })}
        </Group>
      )}

      {line && <p className="mt-5 text-center text-[13px] text-ink-mute">Your business line: {prettyPhone(line.phone_number)}</p>}

      {feat.phone && (
        <button type="button" aria-label="Keypad" onClick={() => { tap(); setKeypad(true); }} className="fab-round" style={{ bottom: "calc(var(--tabbar-h) + var(--sab) + 16px)" }}>
          <Icon.keypad width={26} height={26} />
        </button>
      )}

      {thread && <Thread phone={thread} canCall={feat.phone} jumpTo={jump} onBack={() => { setThread(null); setJump(null); load(); }} />}
      <Compose open={compose} onClose={() => setCompose(false)} onSent={(p) => { setCompose(false); setJump(null); setThread(p); load(); }} />
      {keypad && <Keypad digits={digits} setDigits={setDigits} onClose={() => setKeypad(false)} />}
    </>
  );
}

/** Full-screen dial pad, round keys like the iPhone's. */
function Keypad({ digits, setDigits, onClose }: { digits: string; setDigits: (f: (d: string) => string) => void; onClose: () => void }) {
  const number = toE164(digits);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <div className="chat compose-new keypad-screen" role="dialog" aria-label="Keypad">
      <header className="compose-head" style={{ background: "transparent" }}>
        <span />
        <span className="text-[17px] font-bold">Keypad</span>
        <button type="button" onClick={() => { tap(); onClose(); }} className="justify-self-end text-[17px] font-semibold">Cancel</button>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-[calc(var(--sab)+20px)]">
        <p className="flex h-12 items-center text-[34px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>{typedPretty(digits) || "\u00a0"}</p>
        <div className="keypad-grid mt-5">
          {KEYS.map(([k, sub]) => (
            <button key={k} type="button" className="keypad-key" onClick={() => { tap(); setDigits((d) => (d + k).slice(0, 14)); }}>
              {k}{sub && <small>{sub}</small>}
            </button>
          ))}
          <span />
          <button type="button" aria-label="Call" disabled={!number} className="keypad-key keypad-call" onClick={() => { tap(); startCall({ phone: number }); onClose(); }}><Icon.phone width={30} height={30} strokeWidth={2.1} /></button>
          {digits ? <button type="button" aria-label="Delete" className="keypad-key keypad-del" onClick={() => { tap(); setDigits((d) => d.slice(0, -1)); }}><Icon.backspace width={28} height={28} /></button> : <span />}
        </div>
        <p className="mt-6 text-center text-[13px] text-ink-mute">They see your business number, never your cell.</p>
      </div>
    </div>
  );
}

export function LineSettings({ open, line, onClose, onSaved }: { open: boolean; line: Line; onClose: () => void; onSaved: (l: Line) => void }) {
  const [f, setF] = useState({ forward_to: line.forward_to, ring_seconds: line.ring_seconds, missed_call_text: line.missed_call_text });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const toast = useToast();
  useEffect(() => {
    if (open) setF({ forward_to: line.forward_to, ring_seconds: line.ring_seconds, missed_call_text: line.missed_call_text });
  }, [open, line]);

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const r = await post<{ line: Line }>("/api/v1/phone", f);
      onSaved(r.line);
      success();
      toast("Saved");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Line settings">
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">When a customer calls {prettyPhone(line.phone_number)}, your cell rings. You hear who is calling and press 1 to connect.</p>
      <label className="label mt-4">Ring these cells</label>
      <input className="field" type="text" inputMode="tel" placeholder="(562) 555-1234, (714) 555-0000" value={f.forward_to.startsWith("+1") ? prettyPhoneList(f.forward_to) : f.forward_to} onChange={(e) => setF((x) => ({ ...x, forward_to: e.target.value }))} />
      <p className="mt-1 text-[13px] text-ink-mute">Two or more cells, separated by commas, ring at the same time. Whoever presses 1 first takes the call.</p>
      <label className="label mt-3">Ring for</label>
      <select className="field" value={f.ring_seconds} onChange={(e) => setF((x) => ({ ...x, ring_seconds: Number(e.target.value) }))}>
        {[15, 20, 25, 30, 40].map((s) => <option key={s} value={s}>{s} seconds</option>)}
      </select>
      <label className="label mt-3">Text a missed caller gets</label>
      <textarea className="field" style={{ height: "auto" }} rows={4} maxLength={320} value={f.missed_call_text} onChange={(e) => setF((x) => ({ ...x, missed_call_text: e.target.value }))} />
      {err && <p className="mt-2 text-[13px] font-semibold text-cherry">{err}</p>}
      <div className="mt-4 grid gap-2">
        <button type="button" onClick={save} disabled={busy} className="btn btn-ink h-12">Save</button>
        <button type="button" onClick={onClose} className="btn btn-ghost h-12">Cancel</button>
      </div>
    </Sheet>
  );
}
