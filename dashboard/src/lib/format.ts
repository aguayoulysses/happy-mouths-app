/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → Date. Already-ISO strings pass through. */
export function parseDb(s: string): Date | null {
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(" ", "T") + "Z" : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function timeAgo(s: string): string {
  const d = parseDb(s);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60000);
  if (m < -1) return `in ${fmtDur(-m)}`;
  if (m < 1) return "just now";
  return `${fmtDur(m)} ago`;
}

export function fmtDur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hr`;
  return `${Math.round(h / 24)} d`;
}

export function shortDate(s: string): string {
  const d = parseDb(s);
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

/** "+17145551234,+19495550000" → "(714) 555-1234, (949) 555-0000". */
export function prettyPhoneList(list: string): string {
  return String(list ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(prettyPhone).join(", ");
}

export function prettyPhone(e164: string): string {
  const m = String(e164).match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function delayLabel(min: number): string {
  if (min === 0) return "Right away";
  if (min < 60) return `${min} minutes later`;
  if (min % 1440 === 0) return `${min / 1440} day${min / 1440 === 1 ? "" : "s"} later`;
  if (min % 60 === 0) return `${min / 60} hour${min / 60 === 1 ? "" : "s"} later`;
  return `${Math.floor(min / 60)}h ${min % 60}m later`;
}

export const STATUS: Record<string, { label: string; tone: "mute" | "ink" | "sun" | "leaf" | "cherry" }> = {
  queued: { label: "Scheduled", tone: "mute" },
  sent: { label: "Sent", tone: "ink" },
  opened: { label: "Tapped the link", tone: "ink" },
  reviewed: { label: "Reviewed", tone: "sun" },
  failed: { label: "Failed", tone: "cherry" },
  skipped: { label: "Skipped", tone: "mute" },
};
