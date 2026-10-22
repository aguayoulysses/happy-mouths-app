import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { Sheet } from "./Sheet";
import { prettyPhone } from "../lib/format";
import { tap, success } from "../lib/native";
import { ringBack, type ActiveCall, type CallTarget } from "../lib/voice";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const LABEL: Record<string, string> = { starting: "Calling…", connecting: "Calling…", ringing: "Ringing…", reconnecting: "Reconnecting…", ended: "Call ended" };

function useClock(startedAt: number | null, running: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!startedAt || !running) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt, running]);
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The in-call screen. Covers everything, tab bar included, until the call ends. */
export function CallScreen({ call, onHangup, onMute, onSpeaker, onDigit }: { call: ActiveCall; onHangup: () => void; onMute: (m: boolean) => void; onSpeaker: (s: boolean) => void; onDigit: (d: string) => void }) {
  const [pad, setPad] = useState(false);
  const [typed, setTyped] = useState("");
  const clock = useClock(call.startedAt, call.state === "connected" || call.state === "reconnecting");
  const status = call.state === "ended" && call.error ? call.error : call.state === "connected" ? clock : LABEL[call.state];
  const ended = call.state === "ended";

  return (
    <div className="call-screen" role="dialog" aria-modal="true" aria-label="Call in progress">
      <div className="px-6 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-white/50">Calling as your business</p>
        <h1 className="mt-3 text-[30px] font-extrabold leading-tight tracking-tight">{call.name || prettyPhone(call.phone)}</h1>
        {call.name && <p className="mt-1 text-[16px] text-white/60">{prettyPhone(call.phone)}</p>}
        <p className={`mt-3 min-h-6 text-[17px] font-semibold tabular-nums ${ended && call.error ? "text-cherry" : "text-sun"}`}>{pad && typed ? typed : status}</p>
      </div>

      {pad ? (
        <div className="call-pad">
          {KEYS.map((k) => (
            <button key={k} type="button" className="call-key" onClick={() => { tap(); onDigit(k); setTyped((t) => (t + k).slice(-16)); }}>{k}</button>
          ))}
        </div>
      ) : (
        <div className="call-actions">
          <CallToggle label={call.muted ? "Muted" : "Mute"} on={call.muted} onClick={() => onMute(!call.muted)} icon={<Icon.mic width={26} height={26} />} />
          <CallToggle label="Keypad" on={false} onClick={() => setPad(true)} icon={<Icon.keypad width={26} height={26} />} />
          <CallToggle label="Speaker" on={call.speaker} onClick={() => onSpeaker(!call.speaker)} icon={<Icon.speaker width={26} height={26} />} />
        </div>
      )}

      <div className="flex flex-col items-center gap-4">
        <button type="button" disabled={ended} onClick={() => { tap(); onHangup(); }} className="call-end" aria-label="End call">
          <Icon.phone width={30} height={30} style={{ transform: "rotate(135deg)" }} />
        </button>
        <button type="button" onClick={() => setPad(false)} className={`text-[15px] font-semibold text-white/70 ${pad ? "" : "invisible"}`}>Hide keypad</button>
      </div>
    </div>
  );
}

function CallToggle({ label, on, onClick, icon }: { label: string; on: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button type="button" onClick={() => { tap(); onClick(); }} className="flex flex-col items-center gap-2" aria-pressed={on}>
      <span className={`call-round ${on ? "on" : ""}`}>{icon}</span>
      <span className="text-[13px] font-semibold text-white/70">{label}</span>
    </button>
  );
}

/** Shown when the call can't go out from this device: offer the ring-back way instead. */
export function RingBackSheet({ target, onClose }: { target: (CallTarget & { reason?: string }) | null; onClose: () => void }) {
  const [state, setState] = useState<"ask" | "busy" | "done" | "error">("ask");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (target) setState("ask");
  }, [target]);
  const go = async () => {
    if (!target) return;
    setState("busy");
    try {
      const r = await ringBack(target.phone);
      setMsg(r.message);
      setState("done");
      success();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not place the call.");
      setState("error");
    }
  };
  return (
    <Sheet open={!!target} onClose={onClose} title={target ? `Call ${target.name || prettyPhone(target.phone)}` : ""}>
      {target && (
        <>
          {target.reason && <p className="mt-1 text-[13px] font-semibold text-cherry">{target.reason}</p>}
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
            {state === "done" || state === "error" ? msg : "We ring your cell first. Answer it and we connect you. The customer sees your business number, not your cell."}
          </p>
          <div className="mt-4 grid gap-2">
            {(state === "ask" || state === "busy") && <button type="button" onClick={go} disabled={state === "busy"} className="btn btn-ink h-12">{state === "busy" ? "Placing the call…" : "Ring my cell"}</button>}
            <button type="button" onClick={onClose} className="btn btn-ghost h-12">{state === "done" ? "Done" : "Cancel"}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
