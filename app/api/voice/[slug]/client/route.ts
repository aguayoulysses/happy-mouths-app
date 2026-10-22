// A call placed from inside the app lands here (it is the TwiML App's voice
// URL). We dial the customer showing the business number. `k` is the call key
// the app got with its access token, so only a signed-in owner's call is dialed.

import { run } from "@/lib/db";
import { businessForVoice, twiml, esc, form, voiceUrls, callKeyValid } from "@/lib/voice";
import { normalizePhone, isValidUsPhone } from "@/lib/phone";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const b = await businessForVoice(slug, url.searchParams.get("t"));
  if (!b || !b.feature_phone) return twiml("<Reject/>");
  const f = await form(req);
  const to = normalizePhone(f.To ?? "");
  if (f.From !== `client:business_${b.id}` || !callKeyValid(b, f.k ?? "") || !isValidUsPhone(to)) return twiml("<Reject/>");

  await run("INSERT OR IGNORE INTO calls (business_id, call_sid, direction, from_number, to_number, status, accepted) VALUES (?,?,?,?,?,?,1)", [
    b.id, f.CallSid ?? "", "out", b.sms_number, to, "initiated",
  ]);
  const { root, t } = voiceUrls(b);
  return twiml(
    `<Dial callerId="${esc(b.sms_number)}" answerOnBridge="true" timeout="40" action="${esc(`${root}/status?${t}&direction=out`)}" method="POST">` +
      `<Number>${esc(to)}</Number></Dial>`
  );
}
