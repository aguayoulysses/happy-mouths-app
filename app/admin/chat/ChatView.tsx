"use client";

// The inbox. Polls the feed every few seconds so a client's message shows up without a refresh,
// sends without a page reload, and lets us delete a stray message with one click.

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { repFor } from "@/lib/reps";
import type { ChatMessage, ChatThread } from "@/lib/team-chat";
import { useT } from "../LangProvider";

const POLL_MS = 5000;
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
const when = (loc: string, s: string) => {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + "Z");
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  const days = Math.floor((now.getTime() - d.getTime()) / 86400e3);
  if (days < 7) return `${d.toLocaleDateString(loc, { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString(loc, { month: "short", day: "numeric" })} ${time}`;
};

export function ChatView({ threads: first, selected, initial, me, imessagePhone: firstPhone, lineReady }: { threads: ChatThread[]; selected: number; initial: ChatMessage[]; me: string; imessagePhone: string; lineReady: boolean }) {
  const t = useT();
  const fmt = (s: string) => when(t.locale, s);
  const [threads, setThreads] = useState(first);
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // Reply through the client's app (push) or over our iMessage line. Defaults to wherever they last wrote from.
  const lastFromClient = [...initial].reverse().find((m) => m.sender === "client");
  const [imessagePhone, setImessagePhone] = useState(firstPhone);
  const [cell, setCell] = useState("");
  const [channel, setChannel] = useState<"app" | "imessage">(firstPhone && lastFromClient?.channel === "imessage" ? "imessage" : "app");
  useEffect(() => {
    setImessagePhone(firstPhone);
    setChannel(firstPhone && lastFromClient?.channel === "imessage" ? "imessage" : "app");
  }, [selected, firstPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCell(e: FormEvent) {
    e.preventDefault();
    setError("");
    const r = await fetch("/api/admin/chat", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ business: selected, phone: cell }) });
    const data = (await r.json()) as { phone?: string; error?: string };
    if (!r.ok || !data.phone) return setError(data.error || t("That phone number looks off."));
    setImessagePhone(data.phone);
    setCell("");
  }
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  const open = threads.find((t) => t.id === selected);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length, selected]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/admin/chat?business=${selected}&after=${lastId}`, { cache: "no-store" });
        if (!r.ok || stop) return;
        const data = (await r.json()) as { threads: ChatThread[]; messages: ChatMessage[] };
        setThreads(data.threads);
        if (data.messages.length) setMessages((m) => [...m, ...data.messages.filter((x) => !m.some((y) => y.id === x.id))]);
      } catch { /* next tick */ }
    };
    const id = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [selected, lastId]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending || !selected) return;
    setSending(true);
    setError("");
    try {
      const r = await fetch("/api/admin/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ business: selected, body, channel }) });
      const data = (await r.json()) as { message?: ChatMessage; queued?: boolean; threads?: ChatThread[]; error?: string };
      if (!r.ok || (!data.message && !data.queued)) throw new Error(data.error || t("Could not send"));
      if (data.message) setMessages((m) => [...m, data.message!]);
      if (data.threads) setThreads(data.threads);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not send"));
    } finally {
      setSending(false);
    }
  }

  async function remove(id: number) {
    const r = await fetch("/api/admin/chat", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (!r.ok) return;
    const data = (await r.json()) as { threads: ChatThread[] };
    setMessages((m) => m.filter((x) => x.id !== id));
    setThreads(data.threads);
  }

  const unread = threads.reduce((n, t) => n + t.unread, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Messages")}</h1>
          <p className="page-sub">{unread ? t("{n} unread", { n: unread }) : t("Nothing waiting on you")} · {t.n(threads.length, "{n} client", "{n} clients")} · {t("replies show as {who} and push to their phone", { who: open ? repFor(open.rep_key).name : me })}</p>
        </div>
      </div>

      <div className="chat">
        <aside className="chat-list">
          {threads.map((th) => (
            <Link key={th.id} href={`/admin/chat?business=${th.id}`} className={`chat-item ${th.id === selected ? "on" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="avatar">{th.logo_url ? <img src={th.logo_url} alt="" /> : initials(th.name)}</span>
              <span className="chat-item-main">
                <span className="chat-item-top"><span className="chat-item-name">{th.name}</span><span className="chat-item-time">{fmt(th.last_at)}</span></span>
                <span className={`chat-item-preview ${th.unread ? "unread" : ""}`}>{th.last_body ? `${th.last_sender === "team" ? t("You: ") : ""}${th.last_body}` : t("No messages yet")}</span>
              </span>
              {th.unread > 0 && <span className="nav-count">{th.unread}</span>}
            </Link>
          ))}
          {!threads.length && <p className="empty">{t("No live clients.")}</p>}
        </aside>

        <section className="chat-pane">
          {open ? (
            <>
              <div className="chat-head">
                <div>
                  <div className="chat-head-name">{open.name}</div>
                  <div className="chat-head-sub">{open.owner_name || t("Owner")} · {t("manager {who}", { who: repFor(open.rep_key).name })}</div>
                </div>
                <Link href={`/admin/${open.id}`} className="obtn">{t("Open client")}</Link>
              </div>
              <div className="chat-scroll">
                {!messages.length && <p className="empty">{t("No messages yet. Say hi.")}</p>}
                {messages.map((m) => (
                  <div key={m.id} className={`bubble-row ${m.sender === "team" ? "mine" : ""}`}>
                    <div className="bubble">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {m.image_url && <img src={m.image_url} alt="" />}
                      {m.body}
                      <div className="bubble-time">{fmt(m.created_at)}{m.channel === "imessage" ? " · iMessage" : ""}</div>
                    </div>
                    <button type="button" className="bubble-x" title={t("Delete this message")} onClick={() => remove(m.id)}>×</button>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
              <div className="chat-channel">
                <span className="muted" style={{ fontSize: "0.78rem" }}>{t("Send through")}</span>
                <button type="button" className={`pill ${channel === "app" ? "on" : ""}`} onClick={() => setChannel("app")}>{t("Their app")}</button>
                <button type="button" className={`pill ${channel === "imessage" ? "on" : ""}`} onClick={() => setChannel("imessage")}>iMessage{imessagePhone ? ` · ${imessagePhone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")}` : ""}</button>
              </div>
              {channel === "imessage" && !lineReady ? (
                <p className="muted" style={{ fontSize: "0.82rem", padding: "8px 12px" }}>{t("No iMessage line is set up yet.")}</p>
              ) : channel === "imessage" && !imessagePhone ? (
                <form onSubmit={saveCell} className="chat-compose">
                  <input value={cell} onChange={(e) => setCell(e.target.value)} className="ofield" placeholder={t("Their cell for iMessage, e.g. (714) 555-0123")} autoComplete="off" />
                  <button className="obtn primary" disabled={!cell.trim()}>{t("Save number")}</button>
                </form>
              ) : (
              <form onSubmit={send} className="chat-compose">
                <input value={text} onChange={(e) => setText(e.target.value)} className="ofield" placeholder={channel === "imessage" ? t("iMessage {who}", { who: open.owner_name || open.name }) : t("Message {who}", { who: open.owner_name || open.name })} autoComplete="off" autoFocus />
                <button className="obtn primary" disabled={sending || !text.trim()}>{sending ? t("Sending") : t("Send")}</button>
              </form>
              )}
              {error && <p className="notice" style={{ margin: "8px 0 0" }}>{error}</p>}
            </>
          ) : (
            <p className="empty">{t("Pick a client.")}</p>
          )}
        </section>
      </div>
    </>
  );
}
