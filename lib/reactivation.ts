// The review list a client sends at onboarding (past customers, friends, family) goes out a few
// people a day instead of all at once: a steady trickle of new Google reviews looks natural, and
// replies stay easy to keep up with. Each person then gets the normal sequence from their own start.

import type { Business } from "@/lib/auth";
import { addCustomerAndQueue } from "@/lib/requests";
import { parseCustomerList } from "@/app/api/v1/customers/import/route";
import { logEvent } from "@/lib/db";

export const REACTIVATION_PER_DAY = 5;
const FIRST_HOUR = 10; // Pacific
const LAST_HOUR = 16;

/** Minutes between Pacific wall time and UTC on a given day (420 in summer, 480 in winter). */
function pacificOffset(d: Date): number {
  const pt = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((utc.getTime() - pt.getTime()) / 60_000);
}

/** `count` send times, `perDay` a day spread 10am-4pm Pacific, starting with the next slot still ahead today. */
export function dailySlots(count: number, perDay = REACTIVATION_PER_DAY, now = new Date()): Date[] {
  const step = perDay > 1 ? ((LAST_HOUR - FIRST_HOUR) * 60) / (perDay - 1) : 0;
  const out: Date[] = [];
  const today = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  for (let day = 0; out.length < count; day++) {
    for (let i = 0; i < perDay && out.length < count; i++) {
      const wall = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + day, FIRST_HOUR, Math.round(step * i)));
      const at = new Date(wall.getTime() + pacificOffset(wall) * 60_000);
      if (at.getTime() > now.getTime() + 5 * 60_000) out.push(at);
    }
  }
  return out;
}

const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/** Queue a pasted list at `perDay` a day. People already texted, reviewed or opted out are skipped as usual. */
export async function startReactivation(b: Business, text: string, perDay = REACTIVATION_PER_DAY) {
  const { rows, skipped } = parseCustomerList(text);
  const tally = { queued: 0, already_active: 0, already_reviewed: 0, opted_out: 0, do_not_contact: 0, invalid_phone: skipped };
  const slots = dailySlots(rows.length, perDay);
  let used = 0;
  let last: Date | null = null;
  for (const r of rows) {
    const out = await addCustomerAndQueue(b, { name: r.name, phone: r.phone, email: r.email, source: "review-list", sendAt: sql(slots[used]) });
    tally[out.outcome]++;
    if (out.outcome === "queued") last = slots[used++]; // a skipped person doesn't use up a slot
  }
  const days = Math.ceil(used / perDay);
  await logEvent(b.id, "reactivation", `Review list started: ${used} people, ${perDay} a day over ${days} day${days === 1 ? "" : "s"}`);
  return { ...tally, total: rows.length, days, last: last ? sql(last) : "" };
}
