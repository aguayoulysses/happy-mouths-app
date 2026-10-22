// Runs when a call's <Dial> finishes. Incoming: if the owner never pressed 1 it
// was missed, so push the app and text the caller back. Outgoing: just record
// how it ended.

import { one, run, logEvent } from "@/lib/db";
import { businessForVoice, twiml, form, defaultMissedCallText } from "@/lib/voice";
import { normalizePhone, prettyPhone } from "@/lib/phone";
import { sendToCustomer } from "@/lib/sms";
import { pushToBusiness } from "@/lib/push";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const b = await businessForVoice(slug, url.searchParams.get("t"));
  if (!b) return twiml();
  const f = await form(req);
  const callSid = f.CallSid ?? "";

  if (url.searchParams.get("direction") === "out") {
    // In-app calls report through the Dial action (DialCall*); ring-back calls through a status callback (Call*).
    const status = f.DialCallStatus ?? f.CallStatus ?? "";
    const duration = Number(f.DialCallDuration ?? f.CallDuration ?? 0) || 0;
    await run("UPDATE calls SET status=?, duration=? WHERE business_id=? AND call_sid=?", [status, duration, b.id, callSid]);
    return twiml();
  }

  const from = normalizePhone(f.From ?? "");
  const row = await one<{ accepted: number }>("SELECT accepted FROM calls WHERE business_id=? AND call_sid=?", [b.id, callSid]);
  const missed = !Number(row?.accepted ?? 0);
  const status = missed ? (url.searchParams.get("nodial") ? "no-answer" : f.DialCallStatus === "completed" ? "no-answer" : (f.DialCallStatus ?? "no-answer")) : "completed";
  await run("UPDATE calls SET status=?, duration=?, missed=? WHERE business_id=? AND call_sid=?", [
    status, missed ? 0 : Number(f.DialCallDuration ?? 0) || 0, missed ? 1 : 0, b.id, callSid,
  ]);
  if (!missed || !from) return twiml();

  const known = await one<{ name: string }>("SELECT name FROM customers WHERE business_id=? AND phone=?", [b.id, from]);
  const who = known?.name?.trim() || prettyPhone(from);
  const text = b.missed_call_text || defaultMissedCallText(b);
  const sent = await sendToCustomer(b, from, text);
  if (sent.ok) await run("UPDATE calls SET texted_back=1 WHERE business_id=? AND call_sid=?", [b.id, callSid]);
  await logEvent(b.id, "missed_call", `${who}${sent.ok ? ", texted back" : `, text back failed: ${sent.detail}`}`);
  await pushToBusiness(b.id, {
    title: `Missed call from ${who}`,
    body: sent.ok ? "We texted them back. Tap to call them." : "Tap to call them back.",
    data: { kind: "call", phone: from },
    threadId: "calls",
  });
  return twiml();
}
