import type { PluginListenerHandle } from "@capacitor/core";

export type VoiceState = "connecting" | "ringing" | "connected" | "reconnecting" | "ended";
export type VoiceEvent = { state: VoiceState; error?: string; muted?: boolean; speaker?: boolean };

export interface HMVoicePlugin {
  /** Asks for the microphone if needed, then places the call. Resolves once dialing starts. */
  call(opts: { token: string; to: string; key: string; display: string }): Promise<void>;
  hangup(): Promise<void>;
  setMuted(opts: { muted: boolean }): Promise<void>;
  setSpeaker(opts: { on: boolean }): Promise<void>;
  sendDigits(opts: { digits: string }): Promise<void>;
  addListener(event: "state", cb: (e: VoiceEvent) => void): Promise<PluginListenerHandle>;
}

export declare const HMVoice: HMVoicePlugin;
