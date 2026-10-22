// Booking and payment systems post straight to us: no Zapier in the middle.
// Each business gets one unguessable URL per provider. We pull a name and a
// phone out of whatever shape the provider sends, and queue the request the
// same way Quick Add does. Unknown shapes fall through to the "generic"
// parser, which accepts { name, phone } (or common aliases) as JSON or a form.

import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "./phone";

export const PROVIDERS = ["square", "stripe", "calendly", "acuity", "generic"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  square: "Square",
  stripe: "Stripe",
  calendly: "Calendly",
  acuity: "Acuity Scheduling",
  generic: "Custom webhook",
};

export const PROVIDER_HELP: Record<Provider, string> = {
  square: "Square Developer → Webhooks → add this URL, subscribe to payment.completed. Customers need a phone on file.",
  stripe: "Stripe Dashboard → Developers → Webhooks → add this URL for checkout.session.completed and charge.succeeded. Paste the signing secret here.",
  calendly: "Calendly → Integrations → Webhooks → add this URL for invitee.created. Ask for a phone number on your booking form.",
  acuity: "Acuity → Integrations → Webhooks → add this URL for appointment.scheduled.",
  generic: 'POST JSON like {"name":"Jane Doe","phone":"7145551234"} to this URL from anything.',
};

export type Extracted = { name: string; phone: string; email: string; event: string } | null;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" ? (v as J) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function firstPhone(...cands: unknown[]): string {
  for (const c of cands) {
    const p = normalizePhone(str(c));
    if (/^\+1\d{10}$/.test(p)) return p;
  }
  return "";
}

export function extractSquare(body: J): Extracted {
  const type = str(body.type);
  if (type && !/payment\.(completed|updated)|customer\.created|booking\.(created|updated)/.test(type)) return null;
  const data = obj(obj(body.data).object);
  const payment = obj(data.payment);
  const customer = obj(data.customer);
  const booking = obj(data.booking);
  const billing = obj(payment.billing_address) as J;
  const name = [str(customer.given_name), str(customer.family_name)].filter(Boolean).join(" ") || [str(billing.first_name), str(billing.last_name)].filter(Boolean).join(" ");
  const phone = firstPhone(customer.phone_number, payment.buyer_phone_number, booking.customer_phone);
  if (!phone) return null;
  return { name, phone, email: str(customer.email_address) || str(payment.buyer_email_address), event: type || "square" };
}

export function extractStripe(body: J): Extracted {
  const type = str(body.type);
  if (type && !/checkout\.session\.completed|charge\.succeeded|payment_intent\.succeeded|invoice\.paid/.test(type)) return null;
  const o = obj(obj(body.data).object);
  const details = obj(o.customer_details);
  const billing = obj(o.billing_details);
  const name = str(details.name) || str(billing.name) || str(o.customer_name) || "";
  const phone = firstPhone(details.phone, billing.phone, obj(o.metadata).phone);
  if (!phone) return null;
  return { name, phone, email: str(details.email) || str(billing.email) || str(o.customer_email), event: type || "stripe" };
}

export function extractCalendly(body: J): Extracted {
  const type = str(body.event);
  if (type && type !== "invitee.created") return null;
  const p = obj(body.payload);
  const answers = Array.isArray(p.questions_and_answers) ? (p.questions_and_answers as J[]) : [];
  const answerPhone = answers.map((a) => str(a.answer)).find((a) => /^\+?[\d\s().-]{10,}$/.test(a));
  const phone = firstPhone(obj(p.text_reminder_number).number ?? p.text_reminder_number, answerPhone, obj(obj(p.scheduled_event).location).location);
  if (!phone) return null;
  return { name: str(p.name) || [str(p.first_name), str(p.last_name)].filter(Boolean).join(" "), phone, email: str(p.email), event: type || "calendly" };
}

export function extractAcuity(body: J): Extracted {
  const name = [str(body.firstName), str(body.lastName)].filter(Boolean).join(" ");
  const phone = firstPhone(body.phone);
  if (!phone) return null;
  return { name, phone, email: str(body.email), event: str(body.action) || "acuity" };
}

export function extractGeneric(body: J): Extracted {
  const name = str(body.name) || [str(body.first_name ?? body.firstName), str(body.last_name ?? body.lastName)].filter(Boolean).join(" ") || str(body.customer_name);
  const phone = firstPhone(body.phone, body.phone_number, body.mobile, body.cell, obj(body.customer).phone);
  if (!phone) return null;
  return { name, phone, email: str(body.email), event: str(body.event) || "webhook" };
}

export function extract(provider: Provider, body: J): Extracted {
  switch (provider) {
    case "square":
      return extractSquare(body);
    case "stripe":
      return extractStripe(body);
    case "calendly":
      return extractCalendly(body);
    case "acuity":
      return extractAcuity(body);
    default:
      return extractGeneric(body);
  }
}

/** Stripe signs with HMAC-SHA256 over "t.payload"; verify when a secret is on file. */
export function verifyStripeSignature(rawBody: string, header: string, secret: string): boolean {
  if (!secret) return true;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Square signs with HMAC-SHA256 over (notification URL + raw body), base64. */
export function verifySquareSignature(rawBody: string, url: string, header: string, secret: string): boolean {
  if (!secret) return true;
  const expected = createHmac("sha256", secret).update(url + rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header || "");
  return a.length === b.length && timingSafeEqual(a, b);
}
