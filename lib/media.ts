// Pictures in, public URL out. Stored as rows in `media` and served by
// /api/media/<key>. The app shrinks photos before upload, so rows stay small.

import { randomBytes } from "node:crypto";
import { run } from "./db";
import { baseUrl } from "./template";
import type { TwilioAuth } from "./twilio";

const OK_TYPES = /^image\/(jpeg|png|webp|gif)$/;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function storeBytes(businessId: number, bytes: Uint8Array, contentType: string): Promise<string | null> {
  if (!OK_TYPES.test(contentType) || bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  const key = randomBytes(16).toString("hex");
  await run("INSERT INTO media (key, business_id, content_type, data) VALUES (?,?,?,?)", [key, businessId, contentType, bytes]);
  return `${baseUrl()}/api/media/${key}`;
}

export async function storeUpload(businessId: number, file: File): Promise<string | null> {
  return storeBytes(businessId, new Uint8Array(await file.arrayBuffer()), file.type || "image/jpeg");
}

/** A customer's MMS pictures live behind Twilio's login; copy them to us so the app can show them. */
export async function storeInboundMedia(auth: TwilioAuth, businessId: number, items: { url: string; contentType: string }[]): Promise<string[]> {
  const out: string[] = [];
  for (const m of items) {
    try {
      const res = await fetch(m.url, {
        headers: { Authorization: "Basic " + Buffer.from(`${auth.user}:${auth.pass}`).toString("base64") },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const url = await storeBytes(businessId, new Uint8Array(await res.arrayBuffer()), m.contentType.split(";")[0]);
      if (url) out.push(url);
    } catch {
      /* one bad picture never loses the text it came with */
    }
  }
  return out;
}
