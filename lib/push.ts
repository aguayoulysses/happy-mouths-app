// APNs straight over HTTP/2 with a .p8 provider token. No Firebase. Unset env
// means every push is a silent no-op, never an error, because a missed banner
// must never break the text it announces.

import { connect } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";
import { all, one, run } from "./db";
import { BRAND } from "@/lib/whitelabel";

const KEY_ID = process.env.APNS_KEY_ID ?? "";
const TEAM_ID = process.env.APNS_TEAM_ID ?? "";
const BUNDLE_ID = process.env.APNS_BUNDLE_ID ?? BRAND.ios.appId;
const PROD_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
const HOST = process.env.APNS_SANDBOX ? SANDBOX_HOST : PROD_HOST;

function privateKeyPem(): string {
  const raw = process.env.APNS_KEY ?? "";
  if (!raw) return "";
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw, "base64").toString("utf8");
}

export function pushConfigured(): boolean {
  return Boolean(KEY_ID && TEAM_ID && privateKeyPem());
}

let cached: { jwt: string; at: number } | null = null;
function providerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.at < 45 * 60) return cached.jwt;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "ES256", kid: KEY_ID })}.${b64({ iss: TEAM_ID, iat: now })}`;
  const key = createPrivateKey(privateKeyPem());
  const sig = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  cached = { jwt: `${unsigned}.${sig}`, at: now };
  return cached.jwt;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Read by the app on tap: { kind: "review" | "feedback" | "summary", id? } */
  data?: Record<string, string>;
  threadId?: string;
};

type SendResult = { ok: boolean; status: number; reason: string };

function sendOne(token: string, payload: PushPayload, host = HOST): Promise<SendResult> {
  return new Promise((resolve) => {
    const client = connect(host);
    const done = (r: SendResult) => {
      client.close();
      resolve(r);
    };
    client.on("error", (err) => done({ ok: false, status: 0, reason: String(err) }));
    const body = JSON.stringify({
      aps: { alert: { title: payload.title, body: payload.body }, sound: "default", "thread-id": payload.threadId ?? "happy-mouths" },
      ...(payload.data ?? {}),
    });
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken()}`,
      "apns-topic": BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let text = "";
    req.on("response", (h) => (status = Number(h[":status"] ?? 0)));
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      let reason = "";
      try {
        reason = String(JSON.parse(text || "{}").reason ?? "");
      } catch {
        reason = text;
      }
      done({ ok: status === 200, status, reason });
    });
    req.on("error", (err) => done({ ok: false, status: 0, reason: String(err) }));
    req.end(body);
  });
}

export async function savePushToken(businessId: number, token: string, platform = "ios") {
  await run(
    `INSERT INTO push_tokens (business_id, token, platform) VALUES (?,?,?)
     ON CONFLICT(token) DO UPDATE SET business_id=excluded.business_id, platform=excluded.platform, updated_at=datetime('now')`,
    [businessId, token, platform]
  );
}
export async function deletePushToken(token: string) {
  await run("DELETE FROM push_tokens WHERE token=?", [token]);
}

// Which switch governs which kind of push. Anything not listed (the team chat, scheduled-text warnings) always sends.
const SWITCH: Record<string, string> = { text: "notify_texts", reply: "notify_texts", call: "notify_calls", review: "notify_reviews", photos: "notify_photos" };

export async function pushToBusiness(businessId: number, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  const col = SWITCH[payload.data?.kind ?? ""];
  if (col) {
    const pref = await one<{ on: number }>(`SELECT ${col} AS "on" FROM businesses WHERE id=?`, [businessId]);
    if (pref && !Number(pref.on)) return 0;
  }
  let delivered = 0;
  try {
    const rows = await all<{ token: string }>("SELECT token FROM push_tokens WHERE business_id=?", [businessId]);
    for (const row of rows) {
      let r = await sendOne(row.token, payload);
      // A phone running an Xcode-installed build has a sandbox token, which production
      // calls BadDeviceToken. Try sandbox before throwing the token away.
      if (r.reason === "BadDeviceToken" && HOST === PROD_HOST) r = await sendOne(row.token, payload, SANDBOX_HOST);
      if (r.ok) {
        delivered++;
        continue;
      }
      if (r.status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(r.reason)) {
        await deletePushToken(row.token);
      } else {
        console.error("APNs push failed", businessId, r.status, r.reason);
      }
    }
  } catch (err) {
    console.error("push failed", err);
  }
  return delivered;
}
