import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { parseDb } from "../lib/format";
import { shrink } from "../lib/image";
import { tap } from "../lib/native";

// One chat screen for both the team chat and customer texting. It covers the
// whole screen (tab bar included) like a conversation in Messages.

export type ChatMsg = { id: number | string; mine: boolean; body: string; images?: string[]; at: string };

const time = (s: string) => parseDb(s)?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) ?? "";
function day(s: string) {
  const d = parseDb(s);
  if (!d) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === new Date(now.getTime() - 86400e3).toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function ChatView({ title, subtitle, avatar, onBack, onTitleTap, right, banner, messages, focusId, emptyText, placeholder, disabled, onSend }: {
  title: string;
  subtitle?: string;
  avatar: ReactNode;
  onBack: () => void;
  /** Tapping the name and photo (a profile, like in Messages). */
  onTitleTap?: () => void;
  right?: ReactNode;
  banner?: ReactNode;
  messages: ChatMsg[] | null;
  /** Open on this message instead of the bottom (a search result), and flash it so the eye lands on it. */
  focusId?: ChatMsg["id"];
  emptyText?: string;
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string, image: Blob | null) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [lit, setLit] = useState<ChatMsg["id"] | null>(null);
  const jumped = useRef(false);

  useEffect(() => {
    if (!messages?.length) return;
    // The first load with a focused message lands on it; everything after (a new text) goes to the bottom.
    if (focusId !== undefined && !jumped.current) {
      jumped.current = true;
      const el = body.current?.querySelector<HTMLElement>(`[data-msg="${focusId}"]`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        setLit(focusId);
        setTimeout(() => setLit(null), 1800);
        return;
      }
    }
    end.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, focusId]);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  async function picked(f: File | undefined) {
    if (!f) return;
    const blob = await shrink(f);
    setImage({ blob, url: URL.createObjectURL(blob) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if ((!body && !image) || busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      await onSend(body, image?.blob ?? null);
      setText("");
      setImage(null);
      tap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  let lastAt = 0;
  return (
    <div className="chat" role="dialog" aria-label={title}>
      <header className="chat-head">
        <button type="button" className="chat-back" onClick={() => { tap(); onBack(); }} aria-label="Back"><Icon.back width={26} height={26} strokeWidth={2.4} /></button>
        <button type="button" disabled={!onTitleTap} onClick={() => { tap(); onTitleTap?.(); }} className="chat-who">
          <span className="chat-avatar">{avatar}</span>
          <span className="flex max-w-full items-center gap-0.5 text-[12px] font-medium leading-tight text-ink"><span className="truncate">{title}</span>{onTitleTap && <Icon.chevron width={11} height={11} strokeWidth={2.8} className="flex-none text-ink-mute" />}</span>
          {subtitle && <span className="max-w-full truncate text-[10.5px] leading-tight text-ink-mute">{subtitle}</span>}
        </button>
        <div className="chat-actions">{right}</div>
      </header>
      {banner}

      <div className="chat-body" ref={body}>
        {messages === null && <p className="chat-note">Loading…</p>}
        {messages?.length === 0 && emptyText && <p className="chat-note">{emptyText}</p>}
        {messages?.map((m) => {
          const t = parseDb(m.at)?.getTime() ?? 0;
          const show = t - lastAt > 60 * 60 * 1000;
          lastAt = t;
          return (
            <div key={m.id} data-msg={m.id}>
              {show && <p className="chat-day"><b>{day(m.at)}</b> {time(m.at)}</p>}
              <div className={`chat-row ${m.mine ? "mine" : ""}`}>
                <div className={`chat-bubble ${m.mine ? "mine" : ""} ${lit === m.id ? "lit" : ""}`}>
                  {m.images?.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="chat-img" /></a>)}
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} style={{ height: 12 }} />
      </div>

      {error && <p className="px-4 pb-1 text-[13px] font-semibold text-cherry">{error}</p>}
      <form className="chat-compose" onSubmit={submit}>
        {image && (
          <div className="relative mb-2 inline-block">
            <img src={image.url} alt="" className="h-20 rounded-xl border border-line" />
            <button type="button" onClick={() => setImage(null)} aria-label="Remove photo" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-ink text-white"><Icon.close width={13} height={13} strokeWidth={3} /></button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { picked(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="chat-icon" disabled={disabled || busy} onClick={() => file.current?.click()} aria-label="Add a photo"><Icon.camera width={23} height={23} /></button>
          <textarea
            className="chat-input"
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; }}
          />
          <button type="submit" className="chat-send" disabled={disabled || busy || (!text.trim() && !image)} aria-label="Send"><Icon.arrowUp width={17} height={17} strokeWidth={3} /></button>
        </div>
      </form>
    </div>
  );
}

export function Initials({ name, phone }: { name: string; phone: string }) {
  const t = name ? name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") : phone.slice(-2);
  return <span className="text-[13px] font-extrabold">{t}</span>;
}
