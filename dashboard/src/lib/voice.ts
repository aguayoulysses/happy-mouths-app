// Placing a call as the business. In the iOS app the call goes out from the
// phone itself over the internet (HMVoice plugin: Twilio Voice + CallKit). On
// the web, or when that can't start, the ring-back route is the fallback: the
// owner's cell rings first, then the customer is connected.

import { useEffect, useRef, useState } from "react";
import { HMVoice, type VoiceState } from "hm-voice";
import { api, post, ApiError } from "./api";
import { isNative } from "./native";

export type CallTarget = { phone: string; name?: string };
export type ActiveCall = CallTarget & { state: VoiceState | "starting"; startedAt: number | null; muted: boolean; speaker: boolean; error?: string };

/** Anyone can start a call; App owns the one call screen. */
export function startCall(target: CallTarget) {
  window.dispatchEvent(new CustomEvent<CallTarget>("hm:call", { detail: target }));
}

export const ringBack = (phone: string) => post<{ message: string }>("/api/v1/calls/place", { phone });

export function useCallController(inApp: boolean) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [fallback, setFallback] = useState<(CallTarget & { reason?: string }) | null>(null);
  const live = useRef(false);

  useEffect(() => {
    if (!isNative) return;
    const sub = HMVoice.addListener("state", (e) => {
      if (e.state === "ended") {
        live.current = false;
        setCall((c) => (c ? { ...c, state: "ended", error: e.error } : c));
        setTimeout(() => setCall((c) => (c?.state === "ended" ? null : c)), e.error ? 3500 : 900);
        window.dispatchEvent(new Event("hm:call-ended"));
        return;
      }
      setCall((c) => c && {
        ...c,
        state: e.state,
        startedAt: e.state === "connected" ? (c.startedAt ?? Date.now()) : c.startedAt,
        muted: e.muted ?? c.muted,
      });
    });
    return () => {
      sub.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const on = async (ev: Event) => {
      const target = (ev as CustomEvent<CallTarget>).detail;
      if (live.current) return;
      if (!isNative || !inApp) {
        setFallback(target);
        return;
      }
      live.current = true;
      setCall({ ...target, state: "starting", startedAt: null, muted: false, speaker: false });
      try {
        const t = await api<{ token: string; key: string }>("/api/v1/voice/token");
        await HMVoice.call({ token: t.token, key: t.key, to: target.phone, display: target.name || target.phone });
      } catch (err) {
        live.current = false;
        setCall(null);
        // A line without internet calling (409) is not an error to the owner, just the other way to call.
        const quiet = err instanceof ApiError && err.status === 409;
        setFallback({ ...target, reason: quiet ? undefined : err instanceof Error ? err.message : "The call could not start." });
      }
    };
    window.addEventListener("hm:call", on);
    return () => window.removeEventListener("hm:call", on);
  }, [inApp]);

  return {
    call,
    fallback,
    closeFallback: () => setFallback(null),
    hangup: () => HMVoice.hangup().catch(() => {}),
    setMuted: (muted: boolean) => {
      setCall((c) => c && { ...c, muted });
      HMVoice.setMuted({ muted }).catch(() => {});
    },
    setSpeaker: (on: boolean) => {
      setCall((c) => c && { ...c, speaker: on });
      HMVoice.setSpeaker({ on }).catch(() => {});
    },
    digits: (d: string) => HMVoice.sendDigits({ digits: d }).catch(() => {}),
  };
}
