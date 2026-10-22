"use client";

import { useEffect, useState } from "react";

// A big number that counts up from zero once it is on screen ("$1,398", "14", "86%").
// The server renders the final text, so the page is correct before any script runs;
// the count-up only starts after React has taken over.
export function AnimatedNumber({ value, duration = 900 }: { value: string; duration?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    const m = value.match(/^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s);
    if (!m || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setText(value);
    const target = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) return setText(value);
    const decimals = m[2].includes(".") ? m[2].split(".")[1].length : 0;
    const grouped = m[2].includes(",") || target >= 1000;
    const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setText(t < 1 ? `${m[1]}${fmt(target * (1 - Math.pow(1 - t, 3)))}${m[3]}` : value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{text}</>;
}
