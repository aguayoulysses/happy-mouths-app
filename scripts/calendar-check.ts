// Checks the saved calendar connection: npx -y tsx --env-file=.env.local scripts/calendar-check.ts
import { calendarConfigured, isFree, span } from "../lib/calendar";

if (!calendarConfigured()) {
  console.log("RESULT: not configured");
  process.exit(1);
}
const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN!, grant_type: "refresh_token" }),
});
const t = (await res.json()) as { access_token?: string; error?: string };
if (!t.access_token) {
  console.log("RESULT: token refresh failed:", t.error);
  process.exit(1);
}
const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=3&singleEvents=true&orderBy=startTime&timeMin=" + encodeURIComponent(new Date().toISOString()), { headers: { authorization: `Bearer ${t.access_token}` } });
const b = (await r.json()) as { summary?: string; items?: { summary?: string }[]; error?: { status?: string; message?: string } };
if (!r.ok) {
  console.log("RESULT: calendar refused:", r.status, b.error?.status, (b.error?.message ?? "").slice(0, 120));
  process.exit(2);
}
console.log(`RESULT: connected to calendar "${b.summary}", next events:`, (b.items ?? []).map((e) => e.summary).join(" | ") || "(none)");
console.log("Monday 8am-window free check ran:", await isFree(span("2026-09-21", "10:30")));
