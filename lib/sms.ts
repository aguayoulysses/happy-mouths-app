// Every outbound text goes through here so the opt-out check, the do-not-contact check and the dry-run
// switch can never be skipped. Two lanes:
//   sendToCustomer  — a review request or follow-up, on the business's line
//                     (its own Messaging Service if it has one, else the house one)
//   sendToOwner     — us texting the business owner (alerts),
//                     always on the house line

import { sendSms, twilioConfigured, ACCOUNT_SID, PARENT_AUTH, type TwilioAuth } from "./twilio";
import { normalizePhone } from "./phone";
import { one, run } from "./db";
import type { Business } from "./auth";
import { isBlocked } from "./dnc";
import { logConversation } from "./conversations";

const HOUSE_SERVICE = process.env.TWILIO_HM_MESSAGING_SERVICE_SID ?? "";

export type SendResult = { ok: boolean; detail: string };

export function lane(b: Pick<Business, "twilio_account_sid" | "twilio_auth_token" | "messaging_service_sid">): {
  auth: TwilioAuth;
  accountSid: string;
  messagingServiceSid: string;
} | null {
  if (b.messaging_service_sid) {
    const own = b.twilio_account_sid && b.twilio_account_sid !== ACCOUNT_SID;
    return {
      auth: own ? { user: b.twilio_account_sid, pass: b.twilio_auth_token } : PARENT_AUTH,
      accountSid: own ? b.twilio_account_sid : ACCOUNT_SID,
      messagingServiceSid: b.messaging_service_sid,
    };
  }
  if (!HOUSE_SERVICE) return null;
  return { auth: PARENT_AUTH, accountSid: ACCOUNT_SID, messagingServiceSid: HOUSE_SERVICE };
}

export async function isOptedOut(businessId: number, phone: string): Promise<boolean> {
  const r = await one("SELECT 1 AS x FROM opt_outs WHERE business_id=? AND phone=?", [businessId, normalizePhone(phone)]);
  return Boolean(r);
}
export async function recordOptOut(businessId: number, phone: string) {
  await run("INSERT OR IGNORE INTO opt_outs (business_id, phone) VALUES (?,?)", [businessId, normalizePhone(phone)]);
}
export async function clearOptOut(businessId: number, phone: string) {
  await run("DELETE FROM opt_outs WHERE business_id=? AND phone=?", [businessId, normalizePhone(phone)]);
}

async function deliver(l: NonNullable<ReturnType<typeof lane>>, to: string, text: string, label: string, mediaUrls: string[] = []): Promise<SendResult> {
  if (process.env.SMS_DRY_RUN === "true") {
    console.log(`[sms dry-run] ${label} → ${to}: ${text}${mediaUrls.length ? ` [+${mediaUrls.length} image]` : ""}`);
    return { ok: true, detail: "dry-run" };
  }
  if (!twilioConfigured()) return { ok: false, detail: "Twilio not configured" };
  try {
    const r = await sendSms({ ...l, to, body: text, mediaUrls });
    return { ok: true, detail: r.sid };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Every outbound text lands in `messages`, seen only by us in admin, never by the business. */
async function logMessage(businessId: number, laneName: string, to: string, text: string, r: SendResult, requestId = 0, media = 0) {
  await run("INSERT INTO messages (business_id, lane, to_phone, body, ok, detail, request_id, media) VALUES (?,?,?,?,?,?,?,?)", [
    businessId, laneName, to, text, r.ok ? 1 : 0, r.detail.slice(0, 300), requestId, media,
  ]);
}

export async function sendToCustomer(b: Business, rawPhone: string, text: string, requestId = 0, mediaUrls: string[] = []): Promise<SendResult> {
  const to = normalizePhone(rawPhone);
  if (await isOptedOut(b.id, to)) return { ok: false, detail: "opted out" };
  if (await isBlocked(b.id, to)) return { ok: false, detail: "do not contact" };
  const l = lane(b);
  if (!l && !b.demo) {
    const r = { ok: false, detail: "no messaging service configured" };
    await logMessage(b.id, "customer", to, text, r, requestId);
    return r;
  }
  // A demo account (App Review, sales demos) behaves like a real one but never texts anybody.
  const r = b.demo || !l ? { ok: true, detail: "demo" } : await deliver(l, to, text, `business ${b.id}`, mediaUrls);
  await logMessage(b.id, "customer", to, mediaUrls.length ? `${text}\n[poster] ${mediaUrls[0]}` : text, r, requestId, mediaUrls.length);
  // The owner's view of the same text, in that customer's thread. Review-sequence texts (requestId > 0)
  // are logged but marked automated, so the inbox shows conversations, not our outreach.
  if (r.ok) await logConversation({ businessId: b.id, phone: to, direction: "out", body: text, mediaUrls, automated: requestId > 0, sid: r.detail.startsWith("SM") || r.detail.startsWith("MM") ? r.detail : "" });
  return r;
}

export async function sendToOwner(b: Business, text: string): Promise<SendResult> {
  if (!b.owner_phone) return { ok: false, detail: "owner has no phone" };
  if (b.demo) return { ok: true, detail: "demo" };
  const to = normalizePhone(b.owner_phone);
  // A business with its own line hears from us on that line; otherwise the house line.
  const l = lane(b);
  if (!l) return { ok: false, detail: "no messaging service configured" };
  const r = await deliver(l, to, text, `owner ${b.id}`);
  await logMessage(b.id, "owner", to, text, r);
  return r;
}

/** A text to the whole team (HM_LEAD_ALERT_PHONES) on the same registered line the
 *  lead alerts use. Every internal alert goes through here. */
export async function alertOps(text: string): Promise<SendResult> {
  // imported here because meta-leads imports lane() from this file
  const { textAlert } = await import("./meta-leads");
  return textAlert(text, "team-alert");
}
