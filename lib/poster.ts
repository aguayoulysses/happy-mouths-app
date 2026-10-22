// Personalized poster for each review request, attached to the text as MMS.
// Built in: a business with a sign photo on file (businesses.poster_template)
// gets its team holding a sign with the customer's first name, rendered by
// lib/poster-render.ts and served at /api/poster/<code>.jpg.
// Otherwise an external image API can be plugged in:
//
// Env: POSTER_API_URL (POST endpoint), POSTER_API_KEY (sent as Bearer).
// Request body: { name, business, link, code }. Expected reply: { url }.
// Unset or failing → "" and the text goes out without an image. A missing
// poster must never block a review request.

import type { Business } from "./auth";
import { firstName, baseUrl } from "./template";
import { templateVersion } from "./poster-render";

export function posterConfigured(): boolean {
  return Boolean(process.env.POSTER_API_URL);
}

/** `template` is the step's picture key; step 1 passes the business's sign photo when the step names none. */
export async function generatePoster(b: Business, customerName: string, link: string, code: string, template = "", firstStep = true): Promise<string> {
  // Twilio and phones cache pictures by address. Stamp the address with a fingerprint of the
  // template and the renderer's look, so changing either one can never serve yesterday's image.
  const v = template ? await templateVersion(template) : "";
  if (v) return `${baseUrl()}/api/poster/${code}.jpg?t=${encodeURIComponent(template)}&v=${v}`;
  const url = process.env.POSTER_API_URL;
  if (!url || !firstStep) return "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.POSTER_API_KEY ? { authorization: `Bearer ${process.env.POSTER_API_KEY}` } : {}),
      },
      body: JSON.stringify({ name: firstName(customerName) || "friend", business: b.name, link, code, business_slug: b.slug }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.error("poster API", res.status, (await res.text()).slice(0, 200));
      return "";
    }
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    return typeof data.url === "string" && /^https?:\/\//.test(data.url) ? data.url : "";
  } catch (err) {
    console.error("poster API failed", err instanceof Error ? err.message : err);
    return "";
  }
}
