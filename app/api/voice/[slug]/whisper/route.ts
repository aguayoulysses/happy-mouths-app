// Played to the owner only, before the call connects; the customer hears normal
// ringing. "Press 1" is what proves a person answered: if the owner's voicemail
// picks up, nothing is pressed, we hang up that leg, and the call counts as missed.

import { one } from "@/lib/db";
import { businessForVoice, twiml, esc, spokenPhone, voiceUrls } from "@/lib/voice";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const b = await businessForVoice(slug, url.searchParams.get("t"));
  if (!b) return twiml("<Hangup/>");
  const from = url.searchParams.get("from") ?? "";
  const c = url.searchParams.get("c") ?? "";
  const known = from ? await one<{ name: string }>("SELECT name FROM customers WHERE business_id=? AND phone=?", [b.id, from]) : null;
  const who = known?.name?.trim() || (from ? spokenPhone(from) : "");
  const es = b.line_language === "es";
  const lang = es ? "es-MX" : "en-US";
  const name = b.name.replace(/[<>&]/g, "");
  const line = es
    ? `Llamada para ${name}${who ? `, de ${who}` : ""}. Oprima 1 para contestar.`
    : `Call for ${name}${who ? `, from ${who}` : ""}. Press 1 to connect.`;
  const { root, t } = voiceUrls(b);
  return twiml(
    `<Gather numDigits="1" timeout="6" action="${esc(`${root}/accept?${t}&c=${encodeURIComponent(c)}`)}" method="POST">` +
      `<Say language="${lang}">${esc(line)}</Say><Pause length="1"/><Say language="${lang}">${esc(line)}</Say>` +
      `</Gather><Hangup/>`
  );
}
