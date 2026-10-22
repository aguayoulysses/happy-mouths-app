// The business line's voice side. Incoming calls forward to the owner's cell
// with a short announcement and "press 1", so a cell voicemail can never
// swallow a customer. Outgoing calls are placed from inside the app over the
// internet (Twilio Voice SDK) and show the business number.

import { createHmac, timingSafeEqual } from "node:crypto";
import { one } from "./db";
import { ACCOUNT_SID, PARENT_AUTH, type TwilioAuth } from "./twilio";
import { baseUrl } from "./template";
import type { Business } from "./auth";

const API_KEY = process.env.TWILIO_API_KEY ?? "";
const API_SECRET = process.env.TWILIO_API_SECRET ?? "";

export function voiceAccount(b: Pick<Business, "twilio_account_sid" | "twilio_auth_token">): { auth: TwilioAuth; accountSid: string } {
  const own = b.twilio_account_sid && b.twilio_account_sid !== ACCOUNT_SID;
  return own ? { auth: { user: b.twilio_account_sid, pass: b.twilio_auth_token }, accountSid: b.twilio_account_sid } : { auth: PARENT_AUTH, accountSid: ACCOUNT_SID };
}

export async function businessForVoice(slug: string, token: string | null): Promise<Business | null> {
  const b = await one<Business>("SELECT * FROM businesses WHERE slug=?", [slug]);
  if (!b || !token || b.webhook_token !== token) return null;
  return b;
}

export const voiceUrls = (b: Pick<Business, "slug" | "webhook_token">) => {
  const root = `${baseUrl()}/api/voice/${encodeURIComponent(b.slug)}`;
  const t = `t=${b.webhook_token}`;
  return { inbound: `${root}?${t}`, client: `${root}/client?${t}`, root, t };
};

export function twiml(body = "") {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "content-type": "text/xml" } });
}
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function form(req: Request): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

/** "+17145551234" → "7 1 4, 5 5 5, 1 2 3 4" so the voice reads digits, not a number in the billions. */
export function spokenPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? [m[1], m[2], m[3]].map((g) => g.split("").join(" ")).join(", ") : e164.replace(/\D/g, "").split("").join(" ");
}

export function defaultMissedCallText(b: Pick<Business, "name" | "line_language">): string {
  return b.line_language === "es"
    ? `Hola, habla ${b.name}. Perdón que no pudimos contestar su llamada. ¿En qué le podemos ayudar? Responda STOP para no recibir mensajes.`
    : `Hi, this is ${b.name}. Sorry we missed your call. How can we help? Reply STOP to opt out.`;
}

/* ---- Access token for the in-app dialer (a Twilio-flavored JWT, signed with our API key) ---- */

const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

export function voiceAccessToken(b: Business, ttlSeconds = 3600): string {
  const { accountSid } = voiceAccount(b);
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${API_KEY}-${now}`,
    iss: API_KEY,
    sub: accountSid,
    exp: now + ttlSeconds,
    grants: { identity: `business_${b.id}`, voice: { outgoing: { application_sid: b.twiml_app_sid } } },
  };
  const body = `${b64(header)}.${b64(payload)}`;
  return `${body}.${createHmac("sha256", API_SECRET).update(body).digest("base64url")}`;
}

/** In-app calls only work on the account our API key belongs to; a client on its own subaccount uses ring-back. */
export function canCallInApp(b: Business): boolean {
  const own = b.twilio_account_sid && b.twilio_account_sid !== ACCOUNT_SID;
  return Boolean(API_KEY && API_SECRET && b.twiml_app_sid && !own);
}

/* ---- A short-lived key the app sends along with each call, so the TwiML webhook knows the call really came from a signed-in owner ---- */

export function callKey(b: Pick<Business, "id" | "webhook_token">, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", b.webhook_token).update(`${b.id}.${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}
export function callKeyValid(b: Pick<Business, "id" | "webhook_token">, key: string): boolean {
  const [exp, sig] = key.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = createHmac("sha256", b.webhook_token).update(`${b.id}.${exp}`).digest("base64url");
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
