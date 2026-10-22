"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { one, run, logEvent } from "@/lib/db";
import { OPS_COOKIE, createSession, isAdmin } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { normalizePhone, phoneList } from "@/lib/phone";
import { DEFAULT_TEMPLATE } from "@/lib/template";
import { slugify } from "@/app/api/v1/signup/route";
import { syncBusinessReviews } from "@/lib/reviews";
import { PROVIDERS, type Provider } from "@/lib/integrations";
import { saveSteps } from "@/lib/sequence";
import type { Business } from "@/lib/auth";
import { block, unblock } from "@/lib/dnc";
import { findNumber, setNumberVoiceUrl, createTwimlApp, updateTwimlApp, setMessagingInboundUrl } from "@/lib/twilio";
import { pushToBusiness } from "@/lib/push";
import { repFor, REPS } from "@/lib/reps";
import { storeBytes } from "@/lib/media";
import { fireAndSend } from "@/lib/imessage";
import { prepareLogo } from "@/lib/brand-detect";
import { cleanHex } from "@/lib/brand";
import { baseUrl } from "@/lib/template";
import { voiceAccount, voiceUrls } from "@/lib/voice";
import { asLang, LANG_COOKIE } from "@/lib/i18n";
import { launchChecks, sendWelcome, type WelcomeBusiness } from "@/lib/welcome";
import { NAME } from "@/lib/whitelabel";

async function guard() {
  if (!(await isAdmin())) redirect("/admin/login");
}

// Personal sign-in. Each team member (lib/reps.ts) picks their name and types their password once per
// browser; the session cookie lasts 400 days (the browser maximum) and proxy.ts renews it on every
// visit, so in practice they never sign in again on that device. Passwords are set straight in the
// ops_users table; there is no team code and no lockout.
const YEAR_PLUS = 60 * 60 * 24 * 400;

export async function adminLogin(form: FormData) {
  const who = String(form.get("who") ?? "");
  const pw = String(form.get("password") ?? "");
  const rep = REPS.find((r) => r.key === who);
  const wrong = (): never => redirect(`/admin/login?who=${encodeURIComponent(who)}&wrong=1`);
  if (!rep || !pw) wrong();

  const user = await one<{ id: number; password_hash: string }>("SELECT id, password_hash FROM ops_users WHERE key=?", [rep!.key]);
  if (!user || !user.password_hash || !verifyPassword(pw, user.password_hash)) wrong();

  const token = randomBytes(24).toString("hex");
  await run("INSERT INTO ops_sessions (token, user_id) VALUES (?,?)", [token, user!.id]);
  const jar = await cookies();
  jar.set(OPS_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: YEAR_PLUS });
  redirect("/admin");
}

/** The EN / ES toggle. Stored as a cookie for 400 days, like the session, and the page re-renders in place. */
export async function setLang(form: FormData) {
  const lang = asLang(String(form.get("lang") ?? ""));
  const jar = await cookies();
  jar.set(LANG_COOKIE, lang, { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: YEAR_PLUS });
  const h = await headers();
  const ref = h.get("referer") ?? "";
  let back = "/admin";
  try { const u = new URL(ref); if (u.pathname.startsWith("/admin")) back = u.pathname + u.search; } catch { /* keep /admin */ }
  redirect(back);
}

export async function adminLogout() {
  const jar = await cookies();
  const token = jar.get(OPS_COOKIE)?.value;
  if (token) await run("DELETE FROM ops_sessions WHERE token=?", [token]);
  jar.delete(OPS_COOKIE);
  redirect("/admin/login");
}

export async function createBusiness(form: FormData) {
  await guard();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!name || !email || password.length < 8) redirect("/admin/clients/new?error=Name%2C+email+and+an+8%2B+character+password+are+required");
  if (await one("SELECT 1 AS x FROM businesses WHERE email=?", [email])) redirect("/admin/clients/new?error=Email+already+exists");
  let slug = slugify(name);
  for (let i = 2; await one("SELECT 1 AS x FROM businesses WHERE slug=?", [slug]); i++) slug = `${slugify(name)}-${i}`;
  const { lastId } = await run(
    `INSERT INTO businesses (slug, name, owner_name, email, password_hash, owner_phone, review_link, message_template, status, trial_ends_at, webhook_token)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      slug,
      name,
      String(form.get("owner_name") ?? "").trim(),
      email,
      hashPassword(password),
      form.get("owner_phone") ? normalizePhone(String(form.get("owner_phone"))) : "",
      String(form.get("review_link") ?? "").trim(),
      DEFAULT_TEMPLATE,
      String(form.get("status") ?? "active"),
      new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
      randomBytes(16).toString("hex"),
    ]
  );
  await logEvent(lastId, "created", "Created by admin");
  await fireAndSend("client_new", { kind: "client", id: lastId });
  redirect(`/admin/${lastId}`);
}

const EDITABLE = [
  "name", "owner_name", "email", "owner_phone", "review_link", "status", "plan_cents", "timezone",
  "gbp_account_id", "gbp_location_id", "twilio_account_sid", "twilio_auth_token", "messaging_service_sid", "sms_number", "delay_minutes", "auto_reply", "monthly_limit", "track_links", "poster_template", "fixed_cost_cents", "setup_cost_cents",
  "feature_phone", "feature_invoices", "feature_messages", "feature_photos", "rep_key", "forward_to", "ring_seconds", "ring_as_line", "missed_call_text", "line_language", "website", "ads_url", "lead_alert_phones", "web_lead_text", "gate_url", "doc_url", "photo_geo", "gate_enabled", "site_deploy_hook", "site_repo",
] as const;

export async function updateBusiness(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const sets: string[] = [];
  const args: (string | number)[] = [];
  for (const k of EDITABLE) {
    if (!form.has(k)) continue;
    let v: string | number = String(form.get(k) ?? "").trim();
    if (k === "owner_phone" || k === "sms_number") v = v ? normalizePhone(v) : "";
    if (k === "forward_to" || k === "lead_alert_phones") v = phoneList(v).join(",");
    if (k === "email") v = v.toLowerCase();
    if (k === "plan_cents" || k === "delay_minutes" || k === "auto_reply" || k === "monthly_limit" || k === "track_links" || k === "fixed_cost_cents" || k === "setup_cost_cents" || k === "feature_phone" || k === "feature_invoices" || k === "feature_messages" || k === "feature_photos" || k === "ring_seconds" || k === "ring_as_line" || k === "gate_enabled") v = Number(v) || 0;
    if (k === "twilio_auth_token" && v === "") continue; // blank = keep
    sets.push(`${k}=?`);
    args.push(v);
  }
  const pw = String(form.get("new_password") ?? "");
  if (pw) {
    sets.push("password_hash=?");
    args.push(hashPassword(pw));
    // A password set by hand replaces the one on their welcome page, so the page shows this one instead.
    sets.push("welcome_password=?");
    args.push(pw);
  }
  if (sets.length) {
    args.push(id);
    await run(`UPDATE businesses SET ${sets.join(", ")} WHERE id=?`, args);
  }
  redirect(`/admin/${id}?saved=1`);
}

export async function impersonate(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const token = await createSession(id);
  redirect(`/app/?token=${token}`);
}

export async function syncNow(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const b = await one<Business>("SELECT * FROM businesses WHERE id=?", [id]);
  let msg = "not linked";
  if (b) {
    try {
      msg = JSON.stringify(await syncBusinessReviews(b));
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
  }
  redirect(`/admin/${id}?sync=${encodeURIComponent(msg.slice(0, 200))}`);
}

/** Wipes customers, requests, reviews, texts and events for one business. The account itself stays. */
export async function clearBusinessData(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  for (const t of ["requests", "customers", "reviews", "messages", "events", "weekly_summaries", "opt_outs", "do_not_contact"]) {
    await run(`DELETE FROM ${t} WHERE business_id=?`, [id]);
  }
  await logEvent(id, "cleared", "All customer, request, review and message data wiped by admin");
  redirect(`/admin/${id}?saved=1`);
}

export async function createIntegration(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const provider = String(form.get("provider") ?? "");
  if (!PROVIDERS.includes(provider as Provider)) redirect(`/admin/${id}`);
  await run("INSERT INTO integrations (business_id, provider, token, signing_secret) VALUES (?,?,?,?)", [
    id, provider, randomBytes(18).toString("base64url"), String(form.get("signing_secret") ?? "").trim(),
  ]);
  await logEvent(id, "integration", `${provider} webhook created by admin`);
  redirect(`/admin/${id}?saved=1`);
}

export async function deleteIntegration(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  await run("DELETE FROM integrations WHERE id=? AND business_id=?", [Number(form.get("integration_id")), id]);
  redirect(`/admin/${id}?saved=1`);
}

export async function saveSequence(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const bodies = form.getAll("body").map(String);
  const delays = form.getAll("delay").map(String);
  const units = form.getAll("unit").map(String);
  const posters = form.getAll("poster").map(String);
  const steps = bodies.map((body, i) => {
    const n = Number(delays[i] ?? 0) || 0;
    const mult = units[i] === "days" ? 1440 : units[i] === "hours" ? 60 : 1;
    return { delay_minutes: n * mult, body, poster_template: posters[i] ?? "" };
  });
  await saveSteps(id, steps);
  await logEvent(id, "sequence", `Sequence saved with ${steps.filter((s) => s.body.trim()).length} steps`);
  redirect(`/admin/${id}?saved=1#sequence`);
}

export async function blockContact(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const r = await block(id, { phone: String(form.get("phone") ?? ""), name: String(form.get("name") ?? ""), reason: String(form.get("reason") ?? ""), addedBy: "admin" });
  redirect(`/admin/${id}?${r.ok ? "saved=1" : "sync=" + encodeURIComponent("Not a valid US phone number")}#dnc`);
}

export async function unblockContact(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  await unblock(id, String(form.get("phone") ?? ""), "admin");
  redirect(`/admin/${id}?saved=1#dnc`);
}

/**
 * Wires a business's number for calls: incoming calls start hitting our voice webhook, and a TwiML
 * App is created for calls placed inside the app. Texting is not touched. The number's previous
 * voice URL is written to the timeline so it can be put back by hand.
 */
export async function setupPhoneLine(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const b = await one<Business>("SELECT * FROM businesses WHERE id=?", [id]);
  let msg = "Business not found";
  if (b) {
    try {
      if (!b.sms_number) throw new Error("Set the sending number first");
      if (!b.webhook_token) {
        b.webhook_token = randomBytes(16).toString("hex");
        await run("UPDATE businesses SET webhook_token=? WHERE id=?", [b.webhook_token, id]);
      }
      const { auth, accountSid } = voiceAccount(b);
      const urls = voiceUrls(b);
      const num = await findNumber(auth, accountSid, b.sms_number);
      if (!num) throw new Error(`${b.sms_number} is not a number on this Twilio account`);
      let appSid = b.twiml_app_sid;
      if (appSid) await updateTwimlApp(auth, accountSid, appSid, urls.client);
      else appSid = (await createTwimlApp(auth, accountSid, `${NAME}: ${b.slug}`, urls.client)).sid;
      if (num.voice_url !== urls.inbound) {
        await setNumberVoiceUrl(auth, accountSid, num.sid, urls.inbound);
        await logEvent(id, "phone_setup", `Voice URL was: ${num.voice_url || "(none)"}`);
      }
      await run("UPDATE businesses SET number_sid=?, twiml_app_sid=?, feature_phone=1 WHERE id=?", [num.sid, appSid, id]);
      msg = `Phone line is live. Incoming calls and in-app calling now run through ${NAME}.`;
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
  }
  redirect(`/admin/${id}?sync=${encodeURIComponent(msg.slice(0, 200))}#features`);
}

/** Points the business's Messaging Service at our inbound webhook so customer texts land in the app's inbox. */
export async function setupTexting(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const b = await one<Business>("SELECT * FROM businesses WHERE id=?", [id]);
  let msg = "Business not found";
  if (b) {
    try {
      if (!b.messaging_service_sid) throw new Error("This business sends on the house line. Give it its own Messaging Service first.");
      const want = `${baseUrl()}/api/sms/inbound?b=${b.webhook_token}`;
      const before = await setMessagingInboundUrl(voiceAccount(b).auth, b.messaging_service_sid, want);
      if (before !== want) await logEvent(id, "texting_setup", `Inbound text URL was: ${before || "(none)"}`);
      await run("UPDATE businesses SET feature_messages=1 WHERE id=?", [id]);
      msg = `Incoming texts now land in ${NAME}.`;
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
  }
  redirect(`/admin/${id}?sync=${encodeURIComponent(msg.slice(0, 200))}#features`);
}

/** Our side of the team chat. The owner gets a push with the rep's name on it. */
export async function replyTeamChat(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const text = String(form.get("body") ?? "").trim().slice(0, 2000);
  const b = await one<Business>("SELECT * FROM businesses WHERE id=?", [id]);
  if (b && text) {
    await run("INSERT INTO team_messages (business_id, sender, body) VALUES (?,?,?)", [id, "team", text]);
    await run("UPDATE team_messages SET read_at=datetime('now') WHERE business_id=? AND sender='client' AND read_at IS NULL", [id]);
    await pushToBusiness(id, { title: repFor(b.rep_key).name, body: text.slice(0, 160), data: { kind: "team" }, threadId: "team" });
  }
  redirect(`/admin/${id}#chat`);
}

/** The logo that goes on this business's receipts, invoices and quotes. Its colors become the document colors. An empty upload removes it. */
export async function saveLogo(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    await run("UPDATE businesses SET logo_url='', brand_color='', brand_accent='' WHERE id=?", [id]);
    redirect(`/admin/${id}?sync=${encodeURIComponent("Logo removed.")}#features`);
  }
  const logo = await prepareLogo(new Uint8Array(await file.arrayBuffer()), file.type || "image/jpeg");
  const url = logo ? await storeBytes(id, logo.bytes, logo.contentType) : null;
  if (!logo || !url) redirect(`/admin/${id}?sync=${encodeURIComponent("That file is too large or not an image (PNG or JPG, under 1 MB works best).")}#features`);
  await run("UPDATE businesses SET logo_url=?, brand_color=?, brand_accent=? WHERE id=?", [url, logo.main, logo.accent, id]);
  redirect(`/admin/${id}?sync=${encodeURIComponent("Logo saved. Their invoices now carry it and its colors.")}#features`);
}

/** Override the document colors picked from the logo. */
export async function saveBrandColors(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  await run("UPDATE businesses SET brand_color=?, brand_accent=? WHERE id=?", [cleanHex(String(form.get("brand_color") ?? "")), cleanHex(String(form.get("brand_accent") ?? "")), id]);
  redirect(`/admin/${id}?sync=${encodeURIComponent("Invoice colors saved.")}#features`);
}

/** System page: run a scheduled job right now and record it like a normal run. */
export async function runJob(form: FormData) {
  await guard();
  const name = String(form.get("job") ?? "");
  let out: unknown = { error: "unknown job" };
  let ok = 0;
  try {
    if (name === "costs") out = await (await import("@/lib/costs")).priceMessages();
    else if (name === "reviews") out = await (await import("@/lib/reviews")).syncAllReviews();
    else if (name === "sites") out = await (await import("@/lib/sites")).checkAllSites();
    else if (name === "insights") out = await (await import("@/lib/insights")).syncAllInsights();
    else if (name === "photos") { const p = await import("@/lib/photos"); out = { ...(await p.sweepPhotos()), nudged: await p.nudgeForPhotos() }; }
    else if (name === "health") out = { nudged: await (await import("@/lib/health")).nudgeForCustomers() };
    else if (name === "send") out = await (await import("@/lib/requests")).sendDueRequests();
    ok = JSON.stringify(out).includes('"error"') ? 0 : 1;
  } catch (err) {
    out = { error: err instanceof Error ? err.message : String(err) };
  }
  await run("INSERT INTO cron_runs (name, ok, detail) VALUES (?,?,?)", [name, ok, JSON.stringify(out).slice(0, 2000)]);
  redirect("/admin/system");
}

/** Launch handoff: login + private welcome page + a text to the owner. Locked until every launch check passes. */
export async function sendWelcomeAction(form: FormData) {
  await guard();
  const id = Number(form.get("id"));
  const b = await one<WelcomeBusiness>("SELECT * FROM businesses WHERE id=?", [id]);
  if (!b) redirect("/admin");
  const missing = (await launchChecks(b)).filter((c) => !c.ok);
  if (missing.length) redirect(`/admin/${id}?sync=${encodeURIComponent(`Not ready: ${missing.map((c) => c.label).join(", ")}.`)}#launch`);
  const r = await sendWelcome(b);
  redirect(`/admin/${id}?sync=${encodeURIComponent(r.ok ? `Welcome texted to ${b.owner_name || "the owner"}. Their page: ${r.url}` : `Page ready but the text failed (${r.detail}). Send them the link yourself: ${r.url}`)}#launch`);
}
