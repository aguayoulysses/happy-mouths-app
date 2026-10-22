// The owner pressed a key on the whisper. 1 connects (an empty response lets
// Twilio bridge the two legs); anything else drops the owner's leg.

import { run } from "@/lib/db";
import { businessForVoice, twiml, form } from "@/lib/voice";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const b = await businessForVoice(slug, url.searchParams.get("t"));
  if (!b) return twiml("<Hangup/>");
  const f = await form(req);
  if (f.Digits !== "1") return twiml("<Hangup/>");
  await run("UPDATE calls SET accepted=1, status='in-progress' WHERE business_id=? AND call_sid=?", [b.id, url.searchParams.get("c") ?? ""]);
  return twiml();
}
