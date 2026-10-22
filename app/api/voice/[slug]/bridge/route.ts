// Ring-back fallback (no internet calling available): the owner's cell rang and
// they answered, so say who we are connecting and dial the customer showing
// the business number.

import { businessForVoice, twiml, esc, spokenPhone } from "@/lib/voice";
import { normalizePhone, isValidUsPhone } from "@/lib/phone";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const b = await businessForVoice(slug, url.searchParams.get("t"));
  const to = normalizePhone(url.searchParams.get("to") ?? "");
  if (!b || !b.sms_number || !isValidUsPhone(to)) return twiml("<Hangup/>");
  const es = b.line_language === "es";
  return twiml(
    `<Say language="${es ? "es-MX" : "en-US"}">${es ? "Conectando con" : "Connecting you to"} ${esc(spokenPhone(to))}.</Say>` +
      `<Dial callerId="${esc(b.sms_number)}" timeout="40">${esc(to)}</Dial>`
  );
}
