export const DEFAULT_TEMPLATE =
  "Hi {name}, thank you for trusting {business}! We would love to hear about your experience. It only takes 30 seconds: {link}";

export function firstName(full: string): string {
  return String(full ?? "").trim().split(/\s+/)[0] ?? "";
}

export function renderTemplate(template: string, vars: { name: string; business: string; link: string }): string {
  const t = template?.trim() ? template : DEFAULT_TEMPLATE;
  const name = firstName(vars.name);
  return t
    .replace(/\{name\}/gi, name || "there")
    .replace(/\{first_name\}/gi, name || "there")
    .replace(/\{business\}/gi, vars.business)
    .replace(/\{link\}/gi, vars.link)
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function baseUrl(): string {
  return (process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3016").replace(/\/$/, "");
}

/**
 * The link in the text. On our domain by default; a business with gate_url set
 * (its own site rewriting /review/:code to our /r/:code) gets its own domain.
 * With the gate on it asks for stars first; otherwise it records the tap and forwards to Google.
 */
/** A quote, invoice or receipt link. Same idea: the business's own domain when doc_url is set. */
export function docUrl(token: string, b?: { doc_url?: string }): string {
  const own = (b?.doc_url ?? "").trim().replace(/\/$/, "");
  return own ? `${own}/${token}` : `${baseUrl()}/d/${token}`;
}

export function gateUrl(code: string, b?: { gate_url?: string }): string {
  const own = (b?.gate_url ?? "").trim().replace(/\/$/, "");
  return own ? `${own}/${code}` : `${baseUrl()}/r/${code}`;
}
