// Ring-back fallback for when internet calling is not available (the web
// dashboard, or a bad data connection): Twilio rings the owner's cell first,
// and when they answer it dials the customer showing the business number.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { run } from "@/lib/db";
import { normalizePhone, isValidUsPhone, prettyPhone, phoneList } from "@/lib/phone";
import { placeCall } from "@/lib/twilio";
import { voiceAccount, voiceUrls } from "@/lib/voice";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_phone || !b.sms_number) return fail("No business line on this account.", 404);
  const p = await body<{ phone?: string }>(req);
  const to = normalizePhone(String(p.phone ?? ""));
  if (!isValidUsPhone(to)) return fail("Enter a valid US phone number.");
  const cell = phoneList(b.forward_to || b.owner_phone)[0] ?? "";
  if (!isValidUsPhone(cell)) return fail("Set the cell your line rings on first.", 409);
  const { root, t } = voiceUrls(b);
  try {
    const c = await placeCall({
      ...voiceAccount(b),
      from: b.sms_number,
      to: cell,
      url: `${root}/bridge?${t}&to=${encodeURIComponent(to)}`,
      statusCallback: `${root}/status?${t}&direction=out`,
    });
    await run("INSERT OR IGNORE INTO calls (business_id, call_sid, direction, from_number, to_number, status, accepted) VALUES (?,?,?,?,?,?,1)", [
      b.id, c.sid, "out", b.sms_number, to, "initiated",
    ]);
    return json({ placed: true, message: `Your cell will ring now. Answer it and we connect you to ${prettyPhone(to)}.` });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not place the call.", 502);
  }
}
