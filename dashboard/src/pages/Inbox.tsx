import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, post, patch, upload } from "../lib/api";
import { ChatView, Initials, type ChatMsg } from "../ui/Chat";
import { Sheet } from "../ui/Sheet";
import { Group, Row, EmptyRow, Skeleton } from "../ui/bits";
import { Icon } from "../ui/icons";
import { useToast } from "../ui/Toast";
import { prettyPhone, timeAgo } from "../lib/format";
import { tap, success } from "../lib/native";
import { startCall } from "../lib/voice";

export type ThreadRow = { phone: string; name: string; unread: number; last_body: string; last_direction: string; last_at: string };
/** One text that matched the search: tapping it opens the thread on that exact text. */
export type MessageHit = { id: number; phone: string; name: string; body: string; direction: string; created_at: string };
type Found = { threads: ThreadRow[]; hits: MessageHit[] };
type Msg = { id: number; direction: "in" | "out"; body: string; media_urls: string[]; created_at: string };
type ThreadData = { phone: string; name: string; opted_out: boolean; review: "none" | "asked" | "reviewed"; messages: Msg[] };

const toE164 = (d: string) => {
  const n = d.replace(/\D/g, "");
  return n.length === 10 ? `+1${n}` : n.length === 11 && n.startsWith("1") ? `+${n}` : "";
};

/** The words typed, bolded wherever they appear in a line of text, like Messages does in its results. */
function Highlight({ text, term }: { text: string; term: string }) {
  const t = term.trim().toLowerCase();
  if (!t) return <>{text}</>;
  const out: ReactNode[] = [];
  let i = 0;
  const lower = text.toLowerCase();
  for (;;) {
    const at = lower.indexOf(t, i);
    if (at < 0) break;
    if (at > i) out.push(text.slice(i, at));
    out.push(<b key={at}>{text.slice(at, at + t.length)}</b>);
    i = at + t.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return <>{out}</>;
}

/** The part of a long text around the first match, so the matching words are on screen, not cut off by the clamp. */
function snippet(body: string, term: string) {
  const flat = body.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(term.trim().toLowerCase());
  if (at <= 36) return flat;
  const from = flat.lastIndexOf(" ", at - 28);
  return `\u2026${flat.slice(from < 0 ? at - 28 : from + 1)}`;
}

/**
 * The list of customer conversations, newest first. The search works like Messages on the iPhone:
 * type a name or number and the person's thread comes up under Conversations; type any words you
 * remember and every text with those words comes up under Messages, each one opening on that text.
 */
export function Threads({ threads: all, onOpen, onCompose }: { threads: ThreadRow[] | null; onOpen: (phone: string, messageId?: number) => void; onCompose: () => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const term = q.trim();
  const searching = term !== "";

  useEffect(() => {
    if (!searching) return setFound(null);
    let live = true;
    const t = setTimeout(() => {
      api<Found>(`/api/v1/conversations?split=1&q=${encodeURIComponent(term)}`)
        .then((r) => live && setFound({ threads: r.threads ?? [], hits: r.hits ?? [] }))
        .catch(() => live && setFound({ threads: [], hits: [] }));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [term, searching]);

  const nothing = searching && found !== null && found.threads.length === 0 && found.hits.length === 0;
  const row = (t: ThreadRow) => (
    <button key={t.phone} type="button" className="thread-row" onClick={() => { tap(); onOpen(t.phone); }}>
      <span className={`thread-dot ${t.unread ? "on" : ""}`} />
      <span className="thread-avatar"><Initials name={t.name} phone={t.phone} /></span>
      <span className="thread-main">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[16px] font-semibold"><Highlight text={t.name || prettyPhone(t.phone)} term={searching ? term : ""} /></span>
          <span className="flex flex-none items-center gap-0.5 text-[14px] text-ink-mute">{timeAgo(t.last_at)}<Icon.chevron width={13} height={13} strokeWidth={2.6} /></span>
        </span>
        <span className="thread-preview">{t.last_body}</span>
      </span>
    </button>
  );

  return (
    <div className="settle settle-3 mt-4">
      {(searching || (all?.length ?? 0) > 0) && (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Icon.search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8e8e93]" width={18} height={18} />
            <input className="field search" placeholder="Search names, numbers, texts" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" autoCorrect="off" autoCapitalize="off" enterKeyHint="search" />
            {q && <button type="button" aria-label="Clear" className="search-clear" onClick={() => setQ("")}><Icon.close width={10} height={10} strokeWidth={3.2} /></button>}
          </div>
          {searching && <button type="button" className="search-cancel" onClick={() => { tap(); setQ(""); }}>Cancel</button>}
        </div>
      )}
      <div className="thread-list">
        {!all && !searching && [0, 1, 2].map((i) => <Row key={i}><div className="flex-1"><Skeleton h={14} w="45%" /><Skeleton h={12} w="70%" className="mt-2" /></div></Row>)}
        {!searching && all?.length === 0 && (
          <EmptyRow title="No texts yet" body="When a customer texts your business line, or you text them, the conversation shows up here.">
            <button type="button" onClick={() => { tap(); onCompose(); }} className="btn btn-ink btn-sm">New message</button>
          </EmptyRow>
        )}
        {!searching && all?.map(row)}

        {searching && found === null && <p className="search-note">Searching…</p>}
        {nothing && <EmptyRow title="No results" body={`Nothing has \u201c${term}\u201d in it. Try part of a name, a phone number, or a word you remember from the text.`} />}
        {searching && found && found.threads.length > 0 && (
          <>
            <p className="search-head">Conversations</p>
            {found.threads.map(row)}
          </>
        )}
        {searching && found && found.hits.length > 0 && (
          <>
            <p className="search-head">Messages</p>
            {found.hits.map((h) => (
              <button key={h.id} type="button" className="thread-row" onClick={() => { tap(); onOpen(h.phone, h.id); }}>
                <span className="thread-dot" />
                <span className="thread-avatar"><Initials name={h.name} phone={h.phone} /></span>
                <span className="thread-main">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[16px] font-semibold">{h.name || prettyPhone(h.phone)}</span>
                    <span className="flex flex-none items-center gap-0.5 text-[14px] text-ink-mute">{timeAgo(h.created_at)}<Icon.chevron width={13} height={13} strokeWidth={2.6} /></span>
                  </span>
                  <span className="thread-preview hit">{h.direction === "out" && <span className="text-ink-soft">You: </span>}<Highlight text={snippet(h.body, term)} term={term} /></span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One customer's conversation. Call them, ask for a review, name them, reply with words or a photo.
 * `jumpTo` (a text's id, from a search result) opens the thread scrolled to that text and lights it up.
 */
export function Thread({ phone, canCall, jumpTo, onBack }: { phone: string; canCall: boolean; jumpTo?: number | null; onBack: () => void }) {
  const [data, setData] = useState<ThreadData | null>(null);
  const [ask, setAsk] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const path = `/api/v1/conversations/${encodeURIComponent(phone)}`;

  const load = useCallback(() => {
    api<ThreadData>(path).then(setData).catch(() => setData((d) => d ?? { phone, name: "", opted_out: false, review: "none", messages: [] }));
  }, [path, phone]);
  useEffect(() => {
    load();
    const poll = setInterval(load, 12000);
    return () => clearInterval(poll);
  }, [load]);

  async function send(text: string, image: Blob | null) {
    if (image) {
      const form = new FormData();
      form.append("body", text);
      form.append("image", image, "photo.jpg");
      await upload(path, form);
    } else {
      await post(path, { body: text });
    }
    load();
  }
  async function askReview() {
    setBusy(true);
    try {
      await post(`${path}/review`, { name: data?.name ?? "" });
      success();
      toast("Review request sent");
      setAsk(false);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't send the request");
      setAsk(false);
    } finally {
      setBusy(false);
    }
  }
  async function saveName() {
    setBusy(true);
    try {
      await patch(path, { name });
      setNaming(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  const shown = data?.name || prettyPhone(phone);
  const chat: ChatMsg[] | null = data?.messages.map((m) => ({ id: m.id, mine: m.direction === "out", body: m.body, images: m.media_urls, at: m.created_at })) ?? null;

  return (
    <>
      <ChatView
        title={shown}
        subtitle={data?.name ? prettyPhone(phone) : "Tap the pencil to add their name"}
        avatar={<Initials name={data?.name ?? ""} phone={phone} />}
        onBack={onBack}
        right={
          <>
            <button type="button" className="chat-icon" aria-label="Name this customer" onClick={() => { tap(); setName(data?.name ?? ""); setNaming(true); }}><Icon.pencil width={20} height={20} /></button>
            {canCall && <button type="button" className="chat-icon" aria-label="Call" onClick={() => { tap(); startCall({ phone, name: data?.name }); }}><Icon.phone width={21} height={21} /></button>}
          </>
        }
        banner={
          data && !data.opted_out ? (
            <div className="flex items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-2.5">
              <p className="text-[13px] text-ink-soft">{data.review === "reviewed" ? "They left you a review." : data.review === "asked" ? "Review request sent. Follow-ups run on their own." : "Happy customer? Send your review request."}</p>
              {data.review === "none" && <button type="button" onClick={() => { tap(); setAsk(true); }} className="btn btn-sun btn-sm shrink-0 gap-1.5"><Icon.star width={15} height={15} />Ask for a review</button>}
            </div>
          ) : data?.opted_out ? (
            <p className="border-b border-line bg-cherry-soft px-4 py-2.5 text-[13px] font-semibold text-cherry">This customer asked not to receive texts.</p>
          ) : null
        }
        messages={chat}
        focusId={jumpTo ?? undefined}
        emptyText="No texts with this customer yet."
        placeholder="Text message"
        disabled={data?.opted_out}
        onSend={send}
      />
      <div className="relative z-[55]">
        <Sheet open={ask} onClose={() => setAsk(false)} title={`Ask ${shown} for a review?`}>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">They get your review text right now, with your Google link. If they don&rsquo;t leave one, your follow-ups go out on their own schedule.</p>
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={askReview} disabled={busy} className="btn btn-ink h-12">{busy ? "Sending…" : "Send the request"}</button>
            <button type="button" onClick={() => setAsk(false)} className="btn btn-ghost h-12">Not now</button>
          </div>
        </Sheet>
        <Sheet open={naming} onClose={() => setNaming(false)} title="Customer name">
          <input className="field mt-3" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" />
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={saveName} disabled={busy} className="btn btn-ink h-12">Save</button>
            <button type="button" onClick={() => setNaming(false)} className="btn btn-ghost h-12">Cancel</button>
          </div>
        </Sheet>
      </div>
    </>
  );
}

type Contact = { name: string; phone: string };

/**
 * New Message, laid out like the iPhone's: a To: line that suggests customers as you type,
 * an empty conversation, and the message bar at the bottom. Sending drops you into the thread.
 */
export function Compose({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (phone: string) => void }) {
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Contact | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setTo(""); setPicked(null); setText(""); setErr("");
    api<{ customers: Contact[] }>("/api/v1/customers").then((r) => setContacts(r.customers)).catch(() => {});
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const typedPhone = toE164(to);
  const phone = picked?.phone ?? typedPhone;
  const q = to.trim().toLowerCase();
  const qDigits = to.replace(/\D/g, "");
  // Names that start with what was typed (first or last name) come before names that merely contain it.
  const rank = (c: Contact) => (c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) ? 0 : 1);
  const matches = picked || !q ? [] : contacts.filter((c) => c.name.toLowerCase().includes(q) || (qDigits.length >= 3 && c.phone.includes(qDigits))).sort((a, b) => rank(a) - rank(b)).slice(0, 8);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!phone || !text.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await post(`/api/v1/conversations/${encodeURIComponent(phone)}`, { body: text.trim() });
      success();
      onSent(phone);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat compose-new" role="dialog" aria-label="New message">
      <header className="compose-head">
        <span />
        <span className="text-[17px] font-bold">New Message</span>
        <button type="button" onClick={() => { tap(); onClose(); }} className="justify-self-end text-[17px] font-semibold text-ink">Cancel</button>
      </header>
      <div className="compose-to">
        <span className="text-[16px] text-ink-mute">To:</span>
        {picked ? (
          <button type="button" className="compose-chip" onClick={() => { setPicked(null); setTo(""); }}>{picked.name || prettyPhone(picked.phone)}<Icon.close width={12} height={12} strokeWidth={3} /></button>
        ) : (
          <input className="compose-to-input" autoFocus autoComplete="off" autoCorrect="off" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Name or number" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto bg-canvas">
        {matches.map((c) => (
          <button key={c.phone} type="button" className="compose-match" onClick={() => { tap(); setPicked(c); }}>
            <span className="chat-avatar"><Initials name={c.name} phone={c.phone} /></span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-[16px] font-semibold">{c.name || prettyPhone(c.phone)}</span>
              {c.name && <span className="block text-[13.5px] text-ink-mute">{prettyPhone(c.phone)}</span>}
            </span>
          </button>
        ))}
        {!picked && typedPhone && matches.length === 0 && <p className="px-5 pt-4 text-[14px] text-ink-mute">Texting {prettyPhone(typedPhone)} from your business number.</p>}
      </div>

      {err && <p className="px-4 pb-1 text-[13px] font-semibold text-cherry">{err}</p>}
      <form className="chat-compose" onSubmit={send}>
        <div className="flex items-end gap-2">
          <textarea
            className="chat-input"
            rows={1}
            value={text}
            placeholder="Text message"
            onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; }}
          />
          <button type="submit" className="chat-send" disabled={busy || !phone || !text.trim()} aria-label="Send"><Icon.arrowUp width={19} height={19} strokeWidth={2.8} /></button>
        </div>
      </form>
    </div>
  );
}
