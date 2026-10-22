// "Phone call" from the rep's profile in the team chat: the owner picks a day
// and time inside our hours, and it lands on the rep's Google Calendar. The
// request also goes into the chat, so the history shows what was agreed.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { run, logEvent } from "@/lib/db";
import { repFor } from "@/lib/reps";
import { prettyPhone, normalizePhone, phoneList } from "@/lib/phone";
import { calendarConfigured, span, nowLocal, isFree, createCallEvent, addToCalendarLink, CAL_TZ } from "@/lib/calendar";
import { alertOps } from "@/lib/sms";
import { NAME } from "@/lib/whitelabel";

export const OPTIONS = preflight;

// Our hours: weekdays, 9:00 to 5:00 Pacific. Last call starts 4:45.
const OPEN = 9 * 60, CLOSE = 17 * 60, LENGTH = 15;

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const p = await body<{ date?: string; time?: string }>(req);
  const date = String(p.date ?? ""), time = String(p.time ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return fail("Pick a day and a time.");
  const [h, m] = time.split(":").map(Number);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6 || h * 60 + m < OPEN || h * 60 + m + LENGTH > CLOSE || m % 15 !== 0) return fail("Calls are weekdays, 9am to 5pm Pacific.");
  const s = span(date, time, LENGTH);
  if (s.start <= nowLocal()) return fail("That time already passed. Pick a later one.");

  const rep = repFor(b.rep_key);
  const cell = b.owner_phone || (phoneList(b.forward_to)[0] ?? "");
  const when = new Date(`${s.start}Z`).toLocaleString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const event = {
    span: s,
    summary: `Phone call: ${b.owner_name || b.name}${b.owner_name ? ` (${b.name})` : ""}`,
    description: `${NAME} support call, ${LENGTH} minutes. You call them.\nCell: ${cell ? prettyPhone(cell) : "not on file, ask in the chat"}\nBusiness: ${b.name}\nBooked from the app's team chat.`,
  };

  let onCalendar = false;
  if (calendarConfigured() && !b.demo) {
    try {
      if (!(await isFree(s))) return fail(`${rep.name} is booked at that time. Pick another one.`, 409);
      await createCallEvent(event);
      onCalendar = true;
    } catch (err) {
      console.error("[team/call] calendar failed:", err);
    }
  }

  await run("INSERT INTO team_messages (business_id, sender, body) VALUES (?,?,?)", [
    b.id, "client", `Please call me ${when} (Pacific)${cell ? ` at ${prettyPhone(cell)}` : ""}.`,
  ]);
  await logEvent(b.id, "call_booked", `${when} PT${onCalendar ? ", on the calendar" : ", NOT on the calendar yet"}`);

  const tail = onCalendar ? "It is on your calendar." : `Add it to your calendar: ${addToCalendarLink(event)}`;
  await alertOps(`${b.name} booked a phone call: ${when} PT${cell ? `, call ${prettyPhone(cell)}` : ""}. ${tail}`).catch(() => {});
  return json({ booked: true, when, timezone: CAL_TZ, on_calendar: onCalendar, add_link: onCalendar ? "" : addToCalendarLink(event) });
}
