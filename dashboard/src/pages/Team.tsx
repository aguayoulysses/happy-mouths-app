import { useCallback, useEffect, useState } from "react";
import { api, post, upload } from "../lib/api";
import { ChatView, type ChatMsg } from "../ui/Chat";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/icons";
import { repPhoto, type Rep } from "../ui/TeamButton";
import { prettyPhone } from "../lib/format";
import { tap } from "../lib/native";
import { NAME } from "../brand";

type Msg = { id: number; sender: "client" | "team"; body: string; image_url: string; created_at: string };
type Resp = { messages: Msg[]; booking_url: string; owner_phone: string };
type CallKind = "phone" | "meet";

/** The owner's direct line to their person at the company. The whole history stays. */
export function Team({ rep, onBack, onRead }: { rep: Rep; onBack: () => void; onRead: () => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [profile, setProfile] = useState(false);
  const [booking, setBooking] = useState<CallKind | null>(null);
  const [phoneCall, setPhoneCall] = useState(false);

  const load = useCallback(() => {
    api<Resp>("/api/v1/team").then((r) => { setData(r); onRead(); }).catch(() => setData((d) => d ?? { messages: [], booking_url: "", owner_phone: "" }));
  }, [onRead]);
  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
  }, [load]);

  async function send(text: string, image: Blob | null) {
    if (image) {
      const form = new FormData();
      form.append("body", text);
      form.append("image", image, "photo.jpg");
      await upload("/api/v1/team", form);
    } else {
      await post("/api/v1/team", { body: text });
    }
    load();
  }

  // Picking a kind of call drops a line in the chat first, so the choice is on the record and
  // the rep knows whether to dial their cell or join a Meet before the booking even lands.
  // Google Meet goes through the booking page (it makes the Meet link). A phone call is picked right
  // here and lands on the rep's calendar, since the booking page can only ever say "Meet".
  async function book(kind: CallKind) {
    setProfile(false);
    if (kind === "phone") {
      setPhoneCall(true);
      return;
    }
    await post("/api/v1/team", { body: "I'd like a 15-minute Google Meet call. Picking a time now." }).catch(() => {});
    load();
    setBooking(kind);
  }

  const chat: ChatMsg[] | null = data?.messages.map((m) => ({ id: m.id, mine: m.sender === "client", body: m.body, images: m.image_url ? [m.image_url] : undefined, at: m.created_at })) ?? null;
  const photo = <img src={repPhoto(rep)} alt="" className="h-full w-full object-cover" />;

  return (
    <>
      <ChatView
        title={rep.name}
        subtitle={`${rep.title} · replies 9am to 5pm PT`}
        avatar={photo}
        onBack={onBack}
        onTitleTap={() => setProfile(true)}
        messages={chat}
        emptyText={`This is your direct line to ${rep.name}. Questions, a change to your texts, something not working, a photo you want us to see. Write it here and ${rep.name} gets back to you. Tap ${rep.name}'s name to set up a call.`}
        placeholder={`Message ${rep.name}`}
        onSend={send}
      />

      <div className="relative z-[55]">
        <Sheet open={profile} onClose={() => setProfile(false)}>
          <div className="flex flex-col items-center pt-1 text-center">
            <span className="h-20 w-20 overflow-hidden rounded-full border border-line">{photo}</span>
            <h2 className="mt-3 text-[22px] font-extrabold tracking-tight">{rep.name}</h2>
            <p className="text-[14px] text-ink-soft">{rep.title} at {NAME}</p>
          </div>
          <p className="mt-5 px-1 text-[13px] font-semibold text-ink-soft">How do you want to talk?</p>
          <div className="group mt-2">
            <Choice icon={<Icon.chat width={20} height={20} />} title="Text" detail="Keep messaging right here" onClick={() => setProfile(false)} />
            <Choice icon={<Icon.phone width={20} height={20} />} title="Phone call" detail={`15 minutes. ${rep.name} calls your cell.`} onClick={() => book("phone")} />
            <Choice icon={<Icon.video width={20} height={20} />} title="Google Meet" detail="15 minutes, on video" onClick={() => book("meet")} />
          </div>
        </Sheet>
      </div>

      <div className="relative z-[55]">
        <PhoneCallSheet open={phoneCall} rep={rep} cell={data?.owner_phone ?? ""} onClose={() => setPhoneCall(false)} onBooked={load} />
      </div>

      {booking && (
        <div className="chat compose-new" style={{ zIndex: 56 }} role="dialog" aria-label="Pick a time">
          <header className="compose-head">
            <span />
            <span className="text-[17px] font-bold">{booking === "phone" ? "Phone call" : "Google Meet"} with {rep.name}</span>
            <button type="button" onClick={() => { tap(); setBooking(null); }} className="justify-self-end text-[17px] font-semibold">Done</button>
          </header>
          <p className="border-b border-line bg-ground px-4 pb-3 text-center text-[13px] text-ink-soft">
            {booking === "phone" ? `Pick a 15-minute slot. ${rep.name} will call your cell at that time.` : "Pick a 15-minute slot. The Meet link comes to your email."}
          </p>
          {data?.booking_url ? (
            <iframe src={data.booking_url} title="Pick a time" className="block w-full flex-1 border-0 bg-white" />
          ) : (
            <p className="chat-note">The calendar is not connected yet. Message {rep.name} a couple of times that work and it gets set up by hand.</p>
          )}
        </div>
      )}
    </>
  );
}

function Choice({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" className="row" onClick={() => { tap(); onClick(); }}>
      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-sun-soft">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block truncate text-[13px] text-ink-mute">{detail}</span>
      </span>
      <Icon.chevron className="text-ink-mute" width={18} height={18} />
    </button>
  );
}

/** Next five weekdays and every quarter hour from 9:00 to 4:45, in Pacific time (our hours). */
function callDays(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
  for (let i = 0; out.length < 5 && i < 10; i++) {
    const d = new Date(Date.now() + i * 86400e3);
    const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(d);
    if (dow === "Sat" || dow === "Sun") continue;
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "short", day: "numeric" }).format(d);
    out.push({ value: fmt.format(d), label });
  }
  return out;
}
function callTimes(date: string): { value: string; label: string }[] {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(", ", "T");
  const out: { value: string; label: string }[] = [];
  for (let min = 9 * 60; min <= 16 * 60 + 45; min += 15) {
    const h = Math.floor(min / 60), m = min % 60;
    const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (`${date}T${value}` <= now) continue;
    out.push({ value, label: `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` });
  }
  return out;
}

function PhoneCallSheet({ open, rep, cell, onClose, onBooked }: { open: boolean; rep: Rep; cell: string; onClose: () => void; onBooked: () => void }) {
  const days = callDays().filter((d) => callTimes(d.value).length > 0);
  const [date, setDate] = useState(days[0]?.value ?? "");
  const times = callTimes(date);
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  useEffect(() => {
    if (open) { setDone(""); setErr(""); }
  }, [open]);
  const picked = times.some((t) => t.value === time) ? time : (times[0]?.value ?? "");

  async function confirm() {
    setBusy(true);
    setErr("");
    try {
      const r = await post<{ when: string }>("/api/v1/team/call", { date, time: picked });
      setDone(r.when);
      onBooked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't book that time.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={done ? "You're set" : `Phone call with ${rep.name}`}>
      {done ? (
        <>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{rep.name} will call {cell ? prettyPhone(cell) : "your cell"} on <span className="font-semibold text-ink">{done}</span> (Pacific time).</p>
          <button type="button" onClick={onClose} className="btn btn-ink mt-4 h-12 w-full">Done</button>
        </>
      ) : (
        <>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">15 minutes. {rep.name} calls {cell ? prettyPhone(cell) : "your cell"}. Times are Pacific.</p>
          <label className="label mt-4">Day</label>
          <select className="field" value={date} onChange={(e) => setDate(e.target.value)}>{days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select>
          <label className="label mt-3">Time</label>
          <select className="field" value={picked} onChange={(e) => setTime(e.target.value)}>{times.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          {err && <p className="mt-2 text-[13px] font-semibold text-cherry">{err}</p>}
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={confirm} disabled={busy || !date || !picked} className="btn btn-ink h-12">{busy ? "Booking…" : "Book the call"}</button>
            <button type="button" onClick={onClose} className="btn btn-ghost h-12">Cancel</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
