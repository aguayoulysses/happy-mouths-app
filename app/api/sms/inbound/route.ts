// Replies to a review request text. Twilio answers STOP/START itself; we
// mirror them into opt_outs so the queue never sends to that number again.
// Anything else is relayed to the owner's cell and pushed to the app.
//
// Mapping a reply to a business: the Messaging Service's inbound URL carries
// ?b=<webhook_token>; failing that we match the "To" number to sms_number.

import { one, run, logEvent } from "@/lib/db";
import { normalizePhone, prettyPhone, phoneList } from "@/lib/phone";
import { recordOptOut, clearOptOut, sendToOwner } from "@/lib/sms";
import { pushToBusiness } from "@/lib/push";
import type { Business } from "@/lib/auth";
import { logConversation } from "@/lib/conversations";
import { storeInboundMedia } from "@/lib/media";
import { voiceAccount } from "@/lib/voice";
import { stopOnReviewedReply } from "@/lib/requests";
import { NAME } from "@/lib/whitelabel";

const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ALTO", "PARE"]);
const START = new Set(["START", "YES", "UNSTOP", "SI", "SÍ"]);

const twiml = (msg = "") =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg}</Message>` : ""}</Response>`, {
    headers: { "content-type": "text/xml" },
  });

export async function POST(req: Request) {
  const url = new URL(req.url);
  const form = Object.fromEntries(new URLSearchParams(await req.text()));
  const from = normalizePhone(form.From ?? "");
  const to = normalizePhone(form.To ?? "");
  const text = String(form.Body ?? "").trim();
  const tokenParam = url.searchParams.get("b") ?? "";

  const b =
    (tokenParam ? await one<Business>("SELECT * FROM businesses WHERE webhook_token=?", [tokenParam]) : null) ??
    (to ? await one<Business>("SELECT * FROM businesses WHERE sms_number=?", [to]) : null);
  if (!b || !from) return twiml();

  // The owner texting their own business line from their cell: nothing to route, and alerting
  // them about their own text would bounce back and forth forever.
  const ownCells = [...phoneList(b.forward_to), b.owner_phone].filter(Boolean).map(normalizePhone);
  if (ownCells.includes(from)) return twiml();

  // Customer pictures (MMS): Twilio sends NumMedia + MediaUrl0..N.
  const numMedia = Math.min(10, Number(form.NumMedia ?? 0) || 0);
  const rawMedia = Array.from({ length: numMedia }, (_, i) => ({ url: String(form[`MediaUrl${i}`] ?? ""), contentType: String(form[`MediaContentType${i}`] ?? "image/jpeg") })).filter((m) => m.url);
  const mediaUrls = rawMedia.length ? await storeInboundMedia(voiceAccount(b).auth, b.id, rawMedia) : [];
  await logConversation({ businessId: b.id, phone: from, direction: "in", body: text, mediaUrls, sid: form.MessageSid ?? "" });

  const word = text.toUpperCase().replace(/[^A-ZÍ]/g, "");
  if (STOP.has(word)) {
    await recordOptOut(b.id, from);
    await run("UPDATE requests SET next_at='', stop_reason='opted out', status=CASE WHEN status='queued' THEN 'skipped' ELSE status END WHERE business_id=? AND next_at != '' AND customer_id IN (SELECT id FROM customers WHERE business_id=? AND phone=?)", [b.id, b.id, from]);
    await logEvent(b.id, "opt_out", prettyPhone(from));
    return twiml();
  }
  if (START.has(word)) {
    await clearOptOut(b.id, from);
    return twiml();
  }

  const customer = await one<{ name: string }>("SELECT name FROM customers WHERE business_id=? AND phone=?", [b.id, from]);
  const who = customer?.name || prettyPhone(from);
  const shown = text || (mediaUrls.length ? (mediaUrls.length === 1 ? "Sent a photo" : `Sent ${mediaUrls.length} photos`) : "");
  await logEvent(b.id, "reply", `${who}: ${shown.slice(0, 200)}`);
  // "Already left you a review": Google may show it under a name we can't match, so take their word for it.
  if (await stopOnReviewedReply(b.id, from, text)) await logEvent(b.id, "rated", `${who} says they already reviewed. Follow-ups stopped.`);
  if (b.feature_messages) {
    // They have the inbox: the push opens that customer's thread.
    await pushToBusiness(b.id, { title: `Text from ${who}`, body: shown.slice(0, 160), data: { kind: "text", phone: from }, threadId: from });
    if (b.owner_alerts) await sendToOwner(b, `${b.name}: ${who} texted your business line: "${shown.slice(0, 200)}" Open the ${NAME} app to reply.`);
  } else {
    await pushToBusiness(b.id, { title: `${who} replied`, body: shown.slice(0, 140), data: { kind: "reply" }, threadId: "replies" });
    if (b.owner_alerts) await sendToOwner(b, `${NAME}: ${who} replied to your review request: "${shown.slice(0, 220)}"`);
  }
  return twiml();
}
