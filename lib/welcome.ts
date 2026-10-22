// The launch handoff (Oct 12 2026). When a client's account is fully wired, one button in ops makes their
// login, a private welcome page (/welcome/<token>: the onboarding video, their login, their own
// review pictures, their links) and texts the owner the link. The page is the same design for every client;
// only the data changes. The temporary password lives on the page until their first sign-in clears it.

import { randomBytes, randomInt } from "node:crypto";
import { one, run, all } from "@/lib/db";
import type { Business } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { lane, sendToOwner } from "@/lib/sms";
import { baseUrl, firstName } from "@/lib/template";
import { prettyPhone } from "@/lib/phone";
import { queueText, kickDrain } from "@/lib/imessage";
import { NAME } from "@/lib/whitelabel";

export type LaunchCheck = { key: string; label: string; ok: boolean; detail: string };

export type WelcomeBusiness = Business & { welcome_token: string; welcome_password: string; welcome_sent_at: string; welcome_opened_at: string; password_hash: string };

/** Everything that has to be live before an owner gets their welcome. The button stays locked until all pass. */
export async function launchChecks(b: WelcomeBusiness): Promise<LaunchCheck[]> {
  const steps = await all<{ n: number }>("SELECT COUNT(*) AS n FROM sequence_steps WHERE business_id=?", [b.id]);
  const gbp = Boolean(b.gbp_location_id) && b.gbp_location_id !== "pending";
  return [
    { key: "owner", label: "Owner name, cell and login email", ok: Boolean(b.owner_name && b.owner_phone && b.email), detail: b.owner_phone ? b.email : "Fill them in under Account." },
    { key: "texting", label: "Texting line wired", ok: Boolean(lane(b)), detail: !lane(b) ? "No texting line yet: set up texting below" : b.messaging_service_sid ? "Their own line" : "Sends on the house line" },
    { key: "google", label: "Google profile connected", ok: gbp, detail: gbp ? "Reviews sync and get replies" : "GBP location id still missing or pending" },
    { key: "link", label: "Google review link", ok: Boolean(b.review_link), detail: b.review_link ? "Set" : "Paste it under Account" },
    { key: "sign", label: "Review picture: sign photo", ok: Boolean(b.poster_template), detail: b.poster_template ? "Set" : "Add it in the Pictures card" },
    { key: "meme", label: "Review picture: follow-up meme", ok: Boolean(b.meme_template), detail: b.meme_template ? "Set" : "Add it in the Pictures card" },
    { key: "sequence", label: "Review sequence saved", ok: Number(steps[0]?.n ?? 0) > 0, detail: "Texts and timing in the Sequence card" },
    // Review texts must link to the client's own domain (theirsite.com/review/...), never our own domain.
    { key: "gate", label: "Review link on their own domain", ok: Boolean(b.gate_url && b.site_ok && b.site_checked_at), detail: !b.gate_url ? "Add the /review rewrite to their site's vercel.json, then fill in \"Review link on their domain\" under Account" : !b.site_ok ? `Not reaching us: ${b.site_detail}` : b.gate_url },
    { key: "site", label: "Website live", ok: Boolean(b.website && b.site_ok && b.site_checked_at), detail: !b.website ? "No website on file" : !b.site_checked_at ? "Not checked yet (daily site check)" : b.site_ok ? b.website : `Down: ${b.site_detail}` },
  ];
}

// Easy to read out loud and type on a phone: two plain words and four digits.
const WORDS = ["sunny", "green", "happy", "tiger", "maple", "river", "cedar", "lucky", "brave", "coral", "amber", "rocket", "eagle", "pepper", "mango", "cobalt"];
function tempPassword(): string {
  return `${WORDS[randomInt(WORDS.length)]}-${WORDS[randomInt(WORDS.length)]}-${randomInt(1000, 10000)}`;
}

/** "2026-10-13 01:39:46" (UTC, as SQLite stores it) → "Oct 12, 6:39 PM" Pacific. */
export function pacific(utc: string): string {
  if (!utc) return "";
  return new Date(`${utc.replace(" ", "T")}Z`).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function welcomeUrl(token: string): string {
  return `${baseUrl()}/welcome/${token}`;
}

/**
 * Make (or reuse) the login and the private page, then text the owner. Sending again keeps the same link
 * and, if they have not signed in yet, the same password, so an earlier text never goes stale.
 */
export async function sendWelcome(b: WelcomeBusiness): Promise<{ ok: boolean; detail: string; url: string }> {
  const token = b.welcome_token || randomBytes(18).toString("base64url");
  let password = b.welcome_password;
  if (!password) {
    password = tempPassword();
    await run("UPDATE businesses SET password_hash=? WHERE id=?", [hashPassword(password), b.id]);
  }
  await run("UPDATE businesses SET welcome_token=?, welcome_password=?, welcome_sent_at=datetime('now') WHERE id=?", [token, password, b.id]);
  const url = welcomeUrl(token);
  const first = firstName(b.owner_name) || "there";
  let text = `Hi ${first}, ${b.name} is live on ${NAME}! Your login, the app and a short walkthrough video are here: ${url}`;
  // A client with their own line should move every online listing to it (Google first), or calls keep going around it.
  if (b.sms_number) text += `\n\nOne thing to do this week: switch the phone number everywhere online to your new business line, ${prettyPhone(b.sms_number)}. Start with your Google Business Profile, then Yelp, Facebook, Instagram, Nextdoor and anywhere else your number is listed. Calls to the new line ring your cell, so you won't miss anything, and every missed call gets an automatic text back.`;
  // From us, not from their business: our own iMessage line (blue bubble) first, their/the house SMS line only if it isn't set up.
  const im = await queueText({ phone: b.owner_phone, body: text });
  if (im.ok) kickDrain();
  const r = im.ok ? { ok: true, detail: "iMessage" } : await sendToOwner(b, text);
  await run("INSERT INTO events (business_id, kind, detail) VALUES (?,?,?)", [b.id, "welcome_sent", r.ok ? `${url} (${im.ok ? "iMessage" : "SMS"})` : `failed: ${r.detail}`]);
  return { ok: r.ok, detail: r.detail, url };
}

/** The page loads by token; the first visit stamps opened_at for the ops card. */
export async function businessForWelcome(token: string): Promise<WelcomeBusiness | null> {
  if (!token || token.length < 16) return null;
  const b = await one<WelcomeBusiness>("SELECT * FROM businesses WHERE welcome_token=?", [token]);
  if (!b) return null;
  if (!b.welcome_opened_at) {
    await run("UPDATE businesses SET welcome_opened_at=datetime('now') WHERE id=?", [b.id]);
    await run("INSERT INTO events (business_id, kind, detail) VALUES (?,?,?)", [b.id, "welcome_opened", ""]);
  }
  return b;
}

/** First real sign-in: the temporary password comes off the page (they keep using it until they change it). */
export async function clearWelcomePassword(businessId: number) {
  await run("UPDATE businesses SET welcome_password='' WHERE id=? AND welcome_password != ''", [businessId]);
}
