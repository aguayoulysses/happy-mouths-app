"use client";

// The onboarding video, the same for every client. Set its URL as "welcomeVideo" in brand.json.

import { useState } from "react";

export function WelcomeVideo({ src }: { src: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line-strong bg-ink">
      <video src={src} controls playsInline preload="metadata" className="block aspect-video w-full" />
    </div>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-ground px-4 py-3">
      <div className="min-w-0">
        <span className="block text-[12px] font-extrabold uppercase tracking-wide text-ink-soft">{label}</span>
        <span className="block truncate font-mono text-[17px] font-bold">{value}</span>
      </div>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}
        className="flex-none rounded-full border border-line-strong bg-white px-3 py-1 text-[13px] font-extrabold"
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
