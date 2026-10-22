// Twilio REST calls with fetch, no SDK. Auth defaults to the parent account's
// API key. A business that has its own subaccount (for example a line that was
// provisioned elsewhere) carries its SID + auth token on its row, and we send
// from that account's Messaging Service instead of the house one.

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const API_KEY = process.env.TWILIO_API_KEY ?? "";
const API_SECRET = process.env.TWILIO_API_SECRET ?? "";
const API = "https://api.twilio.com/2010-04-01";

export type TwilioAuth = { user: string; pass: string };
export const PARENT_AUTH: TwilioAuth = { user: API_KEY, pass: API_SECRET };
export { ACCOUNT_SID };

export function twilioConfigured(): boolean {
  return Boolean(ACCOUNT_SID && API_KEY && API_SECRET);
}

type Form = Record<string, string | string[] | undefined>;

async function call<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", url: string, form?: Form, auth: TwilioAuth = PARENT_AUTH): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(form ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((i) => params.append(k, i));
    else params.append(k, v);
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${auth.user}:${auth.pass}`).toString("base64"),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? params.toString() : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Twilio ${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const e = parsed as { message?: string; code?: number };
    throw new Error(`Twilio ${res.status} (${e.code ?? "?"}): ${e.message ?? text.slice(0, 200)}`);
  }
  return parsed as T;
}

export async function sendSms(opts: {
  auth: TwilioAuth;
  accountSid: string;
  messagingServiceSid: string;
  to: string;
  body: string;
  /** Public image URLs to attach (MMS). */
  mediaUrls?: string[];
  statusCallback?: string;
}): Promise<{ sid: string; status: string }> {
  // A picture can go with no words at all; Twilio rejects an empty Body, so leave it out.
  const form: Form = { MessagingServiceSid: opts.messagingServiceSid, To: opts.to, Body: opts.body || undefined };
  if (opts.mediaUrls?.length) form.MediaUrl = opts.mediaUrls.slice(0, 10);
  if (opts.statusCallback) form.StatusCallback = opts.statusCallback;
  return call<{ sid: string; status: string }>("POST", `${API}/Accounts/${opts.accountSid}/Messages.json`, form, opts.auth);
}

/* ------------------------------------------------------------------ */
/* Voice                                                               */
/* ------------------------------------------------------------------ */

export async function findNumber(auth: TwilioAuth, accountSid: string, e164: string): Promise<{ sid: string; voice_url: string } | null> {
  const r = await call<{ incoming_phone_numbers: Array<{ sid: string; voice_url: string }> }>(
    "GET", `${API}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(e164)}`, undefined, auth
  );
  return r.incoming_phone_numbers?.[0] ?? null;
}

/** Points the number's incoming-call webhook at us. Texting is untouched. */
export async function setNumberVoiceUrl(auth: TwilioAuth, accountSid: string, numberSid: string, voiceUrl: string) {
  return call("POST", `${API}/Accounts/${accountSid}/IncomingPhoneNumbers/${numberSid}.json`, { VoiceUrl: voiceUrl, VoiceMethod: "POST" }, auth);
}

/** The TwiML App is where calls placed from inside the app ask us what to do. */
export async function createTwimlApp(auth: TwilioAuth, accountSid: string, friendlyName: string, voiceUrl: string): Promise<{ sid: string }> {
  return call<{ sid: string }>("POST", `${API}/Accounts/${accountSid}/Applications.json`, { FriendlyName: friendlyName, VoiceUrl: voiceUrl, VoiceMethod: "POST" }, auth);
}
export async function updateTwimlApp(auth: TwilioAuth, accountSid: string, appSid: string, voiceUrl: string) {
  return call("POST", `${API}/Accounts/${accountSid}/Applications/${appSid}.json`, { VoiceUrl: voiceUrl, VoiceMethod: "POST" }, auth);
}

/** Rings `to` from `from`; when answered, Twilio fetches `url` for what to do next. */
export async function placeCall(opts: { auth: TwilioAuth; accountSid: string; from: string; to: string; url: string; statusCallback?: string }): Promise<{ sid: string }> {
  const form: Form = { From: opts.from, To: opts.to, Url: opts.url, Method: "POST" };
  if (opts.statusCallback) {
    form.StatusCallback = opts.statusCallback;
    form.StatusCallbackMethod = "POST";
  }
  return call<{ sid: string }>("POST", `${API}/Accounts/${opts.accountSid}/Calls.json`, form, opts.auth);
}

/** Where a Messaging Service sends incoming texts. Returns the address it had before. */
export async function setMessagingInboundUrl(auth: TwilioAuth, serviceSid: string, inboundUrl: string): Promise<string> {
  const base = `https://messaging.twilio.com/v1/Services/${serviceSid}`;
  const before = await call<{ inbound_request_url?: string }>("GET", base, undefined, auth);
  await call("POST", base, { InboundRequestUrl: inboundUrl, InboundMethod: "POST", UseInboundWebhookOnNumber: "false" }, auth);
  return before.inbound_request_url ?? "";
}
