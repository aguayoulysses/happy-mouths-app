import type { ReactNode } from "react";
import { STATUS } from "../lib/format";
import { TeamButton } from "./TeamButton";
import { MARK, NAME } from "../brand";

export function Skeleton({ h = 16, w = "100%", className = "" }: { h?: number; w?: string | number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h, width: w }} />;
}

const DOT: Record<string, string> = { mute: "#c9c5bb", ink: "#111111", sun: "#feb925", leaf: "#2e9e5b", cherry: "#fd4347" };

/** Status as words with a small dot. No pills, no badges. */
export function Status({ status, className = "" }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, tone: "mute" as const };
  return (
    <span className={`whitespace-nowrap text-[13px] font-semibold ${s.tone === "mute" ? "text-ink-mute" : "text-ink"} ${className}`}>
      <span className="dot" style={{ background: DOT[s.tone], boxShadow: "0 0 0 1.5px #111" }} />
      {s.label}
    </span>
  );
}

export function Group({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`group ${className}`}>{children}</div>;
}

export function Section({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-7 ${className}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="h-section">{title}</h2>
        {aside && <div className="pb-2 pr-1 text-[13px] font-semibold text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return onClick ? (
    <button type="button" onClick={onClick} className="row">{children}</button>
  ) : (
    <div className="row">{children}</div>
  );
}

export function Ledger({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="ledger">
      <span className="text-ink-soft">{label}</span>
      <span><b>{value}</b>{note && <small>{note}</small>}</span>
    </div>
  );
}

export function Stars({ n, size = 15 }: { n: number; size?: number }) {
  const r = Math.round(n);
  return (
    <span className="stars" style={{ fontSize: size }} aria-label={`${n} stars`}>
      {"★".repeat(r)}<span className="off">{"★".repeat(5 - r)}</span>
    </span>
  );
}

export function EmptyRow({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-9 text-center">
      <p className="text-[17px] font-bold tracking-tight">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-xs text-[14px] leading-relaxed text-ink-soft">{body}</p>}
      {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
    </div>
  );
}

/** Small brand masthead that opens every screen on phones (the rail carries it on desktop). */
export function Masthead() {
  return (
    <div className="flex items-center gap-2 pt-2 md:hidden">
      <img src={MARK} alt="" width={26} height={26} />
      <span className="flex-1 text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>{NAME}</span>
      <TeamButton />
    </div>
  );
}
