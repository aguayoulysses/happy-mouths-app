// The business line as the owner sees it: the number, the cell or cells it rings
// (comma separated, all ring at once), and the text a missed caller gets.
// 404 when the feature is off for this business.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { run } from "@/lib/db";
import { phoneList, isValidUsPhone } from "@/lib/phone";
import { canCallInApp, defaultMissedCallText } from "@/lib/voice";
import type { Business } from "@/lib/auth";

export const OPTIONS = preflight;

const line = (b: Business) => ({
  phone_number: b.sms_number,
  forward_to: b.forward_to || b.owner_phone,
  ring_seconds: Number(b.ring_seconds) || 20,
  missed_call_text: b.missed_call_text || defaultMissedCallText(b),
  in_app_calling: canCallInApp(b),
});

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_phone || !b.sms_number) return fail("No business line on this account.", 404);
  return json({ line: line(b) });
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_phone || !b.sms_number) return fail("No business line on this account.", 404);
  const p = await body<{ forward_to?: string; ring_seconds?: number; missed_call_text?: string }>(req);
  const cells = p.forward_to !== undefined ? phoneList(String(p.forward_to)) : phoneList(b.forward_to);
  if (p.forward_to !== undefined) {
    if (!cells.length || !cells.every(isValidUsPhone)) return fail("Enter valid US cell numbers, separated by commas.");
    if (cells.length > 5) return fail("Up to 5 cells can ring at once.");
  }
  if (cells.includes(b.sms_number)) return fail("That is the business number itself. Enter the cell it should ring.");
  const forwardTo = cells.join(",");
  const ring = Math.min(45, Math.max(10, Number(p.ring_seconds ?? b.ring_seconds) || 20));
  const text = String(p.missed_call_text ?? b.missed_call_text).trim().slice(0, 320);
  await run("UPDATE businesses SET forward_to=?, ring_seconds=?, missed_call_text=? WHERE id=?", [forwardTo, ring, text, b.id]);
  return json({ line: line({ ...b, forward_to: forwardTo, ring_seconds: ring, missed_call_text: text }) });
}
