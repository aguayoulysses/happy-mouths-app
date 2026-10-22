// Support phone calls booked from the team chat land on the rep's Google
// Calendar. Uses the same OAuth app as the Business Profile link, with its own
// refresh token that carries the calendar.events scope (GOOGLE_CALENDAR_REFRESH_TOKEN).
// Without that token nothing breaks: the alert text carries a one-tap
// "add to calendar" link instead.


export const CAL_TZ = "America/Los_Angeles";
const CAL_ID = () => encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "primary");

export function calendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_CALENDAR_REFRESH_TOKEN);
}

let cached: { token: string; expiresAt: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) throw new Error(`Calendar token refresh failed: ${data.error ?? "unknown"}`);
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Wall-clock times in the rep's timezone: "2026-09-21T10:30:00". Google applies the zone, so DST is its problem, not ours. */
export type LocalSpan = { start: string; end: string };

export function span(date: string, time: string, minutes = 15): LocalSpan {
  const [h, m] = time.split(":").map(Number);
  const endMin = h * 60 + m + minutes;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${date}T${pad(h)}:${pad(m)}:00`, end: `${date}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00` };
}

/** "Now" as a comparable wall-clock string in the rep's timezone. */
export function nowLocal(): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: CAL_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

export async function isFree(s: LocalSpan): Promise<boolean> {
  const token = await accessToken();
  // freeBusy wants absolute times; ask for the whole day in the zone and compare wall-clock strings.
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${CAL_ID()}/events?${new URLSearchParams({ timeMin: `${s.start.slice(0, 10)}T00:00:00Z`, timeMax: `${s.start.slice(0, 10)}T23:59:59Z`, singleEvents: "true", timeZone: CAL_TZ, maxResults: "100" })}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return true; // never block a booking because the check itself failed
  const data = (await res.json()) as { items?: Array<{ status?: string; transparency?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }> };
  return !(data.items ?? []).some((e) => {
    if (e.status === "cancelled" || e.transparency === "transparent" || !e.start?.dateTime || !e.end?.dateTime) return false;
    const a = e.start.dateTime.slice(0, 19), b = e.end.dateTime.slice(0, 19);
    return a < s.end && b > s.start;
  });
}

export async function createCallEvent(o: { span: LocalSpan; summary: string; description: string }): Promise<string> {
  const token = await accessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${CAL_ID()}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: o.summary,
      description: o.description,
      start: { dateTime: o.span.start, timeZone: CAL_TZ },
      end: { dateTime: o.span.end, timeZone: CAL_TZ },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { htmlLink?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(`Calendar ${res.status}: ${data.error?.message ?? "could not create the event"}`);
  return data.htmlLink ?? "";
}

/** One tap on this link opens Google Calendar with the event filled in. */
export function addToCalendarLink(o: { span: LocalSpan; summary: string; description: string }): string {
  const f = (t: string) => t.replace(/[-:]/g, "");
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: "TEMPLATE", text: o.summary, dates: `${f(o.span.start)}/${f(o.span.end)}`, ctz: CAL_TZ, details: o.description })}`;
}
