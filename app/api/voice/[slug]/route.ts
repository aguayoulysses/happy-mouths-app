// Twilio hits this when someone calls the business number. We ring every cell on
// the line at once (forward_to holds one or more, comma separated) showing the
// customer's number; whoever presses 1 first takes the call (see ./whisper) and
// Twilio drops the other legs. The status route decides if it was missed.

import { run } from "@/lib/db";
import { businessForVoice, twiml, esc, form, voiceUrls } from "@/lib/voice";
import { normalizePhone, phoneList, isValidUsPhone } from "@/lib/phone";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const b = await businessForVoice(slug, url.searchParams.get("t"));
  if (!b || !b.feature_phone) return twiml("<Reject/>");
  const f = await form(req);
  const callSid = f.CallSid ?? "";
  const from = normalizePhone(f.From ?? "");

  await run("INSERT OR IGNORE INTO calls (business_id, call_sid, direction, from_number, to_number, status) VALUES (?,?,?,?,?,?)", [
    b.id, callSid, "in", from, b.sms_number, "ringing",
  ]);

  const { root, t } = voiceUrls(b);
  const cells = phoneList(b.forward_to || b.owner_phone).filter(isValidUsPhone).slice(0, 10);
  if (!cells.length) {
    // Nowhere to ring: go straight to the missed-call path so the caller still gets a text back.
    return twiml(`<Redirect method="POST">${esc(`${root}/status?${t}&nodial=1`)}</Redirect>`);
  }
  const q = `${t}&c=${encodeURIComponent(callSid)}&from=${encodeURIComponent(from)}`;
  return twiml(
    `<Dial timeout="${Math.min(45, Math.max(10, Number(b.ring_seconds) || 20))}" callerId="${esc((!Number(b.ring_as_line) && from) || b.sms_number)}" action="${esc(`${root}/status?${t}`)}" method="POST">` +
      cells.map((cell) => `<Number url="${esc(`${root}/whisper?${q}`)}" method="POST">${esc(cell)}</Number>`).join("") +
      `</Dial>`
  );
}
