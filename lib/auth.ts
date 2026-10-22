import { cookies } from "next/headers";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import { one, run } from "./db";
import { repFor } from "./reps";

export type Business = {
  id: number;
  slug: string;
  name: string;
  owner_name: string;
  email: string;
  owner_phone: string;
  review_link: string;
  message_template: string;
  delay_minutes: number;
  gate_enabled: number;
  status: string;
  trial_ends_at: string;
  plan_cents: number;
  monthly_limit: number;
  timezone: string;
  gbp_account_id: string;
  gbp_location_id: string;
  twilio_account_sid: string;
  twilio_auth_token: string;
  messaging_service_sid: string;
  sms_number: string;
  webhook_token: string;
  owner_alerts: number;
  auto_reply: number;
  poster_template: string;
  track_links: number;
  meme_template: string;
  fixed_cost_cents: number;
  setup_cost_cents: number;
  feature_phone: number;
  feature_invoices: number;
  feature_messages: number;
  feature_photos: number;
  rep_key: string;
  logo_url: string;
  brand_color: string;
  brand_accent: string;
  insights_synced_at: string;
  customers_nudged_at: string;
  demo: number;
  website: string;
  /** Their Google Ads landing page, shown on the welcome page. */
  ads_url: string;
  lead_alert_phones: string;
  gate_url: string;
  doc_url: string;
  photo_geo: string;
  site_deploy_hook: string;
  site_repo: string;
  site_ok: number;
  site_detail: string;
  site_checked_at: string;
  web_lead_text: string;
  notify_texts: number;
  notify_calls: number;
  notify_reviews: number;
  notify_photos: number;
  photo_nudged_at: string;
  forward_to: string;
  ring_seconds: number;
  ring_as_line: number;
  missed_call_text: string;
  line_language: string;
  number_sid: string;
  twiml_app_sid: string;
  created_at: string;
};

export const SESSION_COOKIE = "hm_session";

export async function businessFromToken(token: string | null | undefined): Promise<Business | null> {
  if (!token) return null;
  return one<Business>(
    "SELECT * FROM businesses WHERE id = (SELECT business_id FROM sessions WHERE token = ?)",
    [token]
  );
}

/** Bearer token (the app) or session cookie (web). */
export async function businessFromRequest(req: Request): Promise<Business | null> {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) return businessFromToken(header.slice(7));
  const jar = await cookies();
  return businessFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function createSession(businessId: number): Promise<string> {
  const token = randomUUID();
  await run("INSERT INTO sessions (token, business_id) VALUES (?,?)", [token, businessId]);
  return token;
}

export async function destroySession(token: string) {
  await run("DELETE FROM sessions WHERE token = ?", [token]);
}

export const OPS_COOKIE = "hm_ops";
export type OpsUser = { id: number; key: string; name: string };

/** The signed-in team member, from the session cookie their browser keeps. */
// Memoized per request: the ops layout and the page it wraps both ask, and one lookup serves both.
export const currentOps = cache(async (): Promise<OpsUser | null> => {
  const jar = await cookies();
  const token = jar.get(OPS_COOKIE)?.value;
  if (!token) return null;
  const u = await one<OpsUser>("SELECT u.id, u.key, u.name FROM ops_sessions s JOIN ops_users u ON u.id = s.user_id WHERE s.token=?", [token]);
  if (u) await run("UPDATE ops_sessions SET last_seen=datetime('now') WHERE token=? AND last_seen < datetime('now','-1 hour')", [token]);
  return u;
});

export async function isAdmin(): Promise<boolean> {
  return Boolean(await currentOps());
}

/** Strip secrets before handing a business row to its owner. */
export function publicBusiness(b: Business) {
  const { password_hash: _p, twilio_auth_token: _t, webhook_token: _w, ...rest } = b as Business & { password_hash?: string };
  void _p;
  void _t;
  void _w;
  return {
    ...rest,
    has_own_line: Boolean(b.messaging_service_sid),
    gbp_linked: Boolean(b.gbp_location_id) && b.gbp_location_id !== "pending",
    // What the app is allowed to show. Phone needs the switch and a number that is actually wired.
    features: {
      phone: Boolean(b.feature_phone && b.sms_number && b.twiml_app_sid),
      messages: Boolean(b.feature_messages && b.sms_number),
      invoices: Boolean(b.feature_invoices),
      photos: Boolean(b.feature_photos),
    },
    rep: repFor(b.rep_key),
  };
}
