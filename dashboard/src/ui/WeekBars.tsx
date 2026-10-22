// Eight weeks of requests. Gray is what went out, yellow is what came back
// as a review, drawn at the baseline so the yellow share reads as conversion.

import { useState } from "react";

export type WeekPoint = { week: string; sent: number; reviewed: number };

export function WeekBars({ weeks }: { weeks: WeekPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 132, padT = 18, padB = 20;
  const max = Math.max(4, ...weeks.map((w) => w.sent));
  const n = weeks.length;
  const slot = W / n;
  const bw = Math.min(30, slot * 0.5);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const label = (i: number) => (i === n - 1 ? "This week" : i === n - 2 ? "Last week" : `${n - 1 - i} weeks ago`);
  const shown = hover ?? n - 1;

  return (
    <div>
      <p className="px-1 text-[13px] text-ink-soft">
        <span className="font-semibold text-ink">{label(shown)}:</span> {weeks[shown].sent} sent, <span className="font-semibold text-ink">{weeks[shown].reviewed} reviewed</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block w-full touch-none" role="img" aria-label="Review requests sent and reviews received per week">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#e6e3dc" strokeWidth={1} />
        {weeks.map((w, i) => {
          const cx = slot * i + slot / 2;
          const x = cx - bw / 2;
          const sentTop = y(w.sent), revTop = y(w.reviewed), base = y(0);
          const active = shown === i;
          return (
            <g key={w.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onPointerDown={() => setHover(i)}>
              <rect x={slot * i} y={0} width={slot} height={H} fill="transparent" />
              <rect x={x} y={sentTop} width={bw} height={Math.max(0, base - sentTop)} rx={3} fill={active ? "#c9c5bb" : "#e0dcd3"} className="bar-grow" style={{ animationDelay: `${i * 45}ms` }} />
              {w.reviewed > 0 && <rect x={x} y={revTop} width={bw} height={Math.max(0, base - revTop)} rx={3} fill="#feb925" className="bar-grow" style={{ animationDelay: `${140 + i * 45}ms` }} />}
              <text x={cx} y={H - 5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={active ? "#1a1917" : "#9b978e"}>
                {i === n - 1 ? "now" : `${n - 1 - i}w`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
