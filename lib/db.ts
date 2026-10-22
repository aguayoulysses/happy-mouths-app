// One libSQL client for the whole app. Turso in production (DATABASE_URL =
// libsql://…), a local file in development. Schema is applied once per
// process on first use: CREATE TABLE IF NOT EXISTS for new tables, and an
// additive list of ALTER TABLEs (each wrapped so a column that already exists
// is a no-op) for columns added after launch.

import { createClient, type Client } from "@libsql/client";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let db: Client | null = null;
let ready: Promise<void> | null = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    owner_name TEXT NOT NULL DEFAULT '',
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    owner_phone TEXT NOT NULL DEFAULT '',
    review_link TEXT NOT NULL DEFAULT '',
    message_template TEXT NOT NULL DEFAULT '',
    delay_minutes INTEGER NOT NULL DEFAULT 120,
    gate_enabled INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'trial',
    trial_ends_at TEXT NOT NULL DEFAULT '',
    plan_cents INTEGER NOT NULL DEFAULT 19900,
    monthly_limit INTEGER NOT NULL DEFAULT 100,
    timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    gbp_account_id TEXT NOT NULL DEFAULT '',
    gbp_location_id TEXT NOT NULL DEFAULT '',
    twilio_account_sid TEXT NOT NULL DEFAULT '',
    twilio_auth_token TEXT NOT NULL DEFAULT '',
    messaging_service_sid TEXT NOT NULL DEFAULT '',
    sms_number TEXT NOT NULL DEFAULT '',
    webhook_token TEXT NOT NULL DEFAULT '',
    owner_alerts INTEGER NOT NULL DEFAULT 1,
    auto_reply INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    business_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(business_id, phone)
  )`,
  `CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    send_at TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT '',
    opened_at TEXT NOT NULL DEFAULT '',
    rated_at TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL DEFAULT '',
    message_sid TEXT NOT NULL DEFAULT '',
    poster_url TEXT NOT NULL DEFAULT '',
    step INTEGER NOT NULL DEFAULT 0,
    next_at TEXT NOT NULL DEFAULT '',
    stop_reason TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requests_due ON requests (status, send_at)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_business ON requests (business_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS sequence_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    delay_minutes INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_steps_business ON sequence_steps (business_id, position)`,
  `CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    contact_ok INTEGER NOT NULL DEFAULT 1,
    read_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS opt_outs (
    business_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (business_id, phone)
  )`,
  // Client photos uploaded in admin: the blank-sign photo and the follow-up meme photo. Stored in
  // the database (small JPEGs) so onboarding a client never needs a deploy. Template key = "db:<id>".
  `CREATE TABLE IF NOT EXISTS poster_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'sign',
    image BLOB NOT NULL,
    quad TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // The business's own "never text this person" list. Keyed by phone, not customer id, so it
  // holds no matter where the customer comes from (webhook, CSV, Quick Add) or if they're removed.
  `CREATE TABLE IF NOT EXISTS do_not_contact (
    business_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    added_by TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (business_id, phone)
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    review_name TEXT UNIQUE NOT NULL,
    star_rating INTEGER NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    reviewer_name TEXT NOT NULL DEFAULT '',
    create_time TEXT NOT NULL DEFAULT '',
    reply_comment TEXT NOT NULL DEFAULT '',
    reply_time TEXT NOT NULL DEFAULT '',
    draft_reply TEXT NOT NULL DEFAULT '',
    request_id INTEGER NOT NULL DEFAULT 0,
    notified_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY,
    business_id INTEGER NOT NULL,
    platform TEXT NOT NULL DEFAULT 'ios',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    signing_secret TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    events INTEGER NOT NULL DEFAULT 0,
    last_event_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    lane TEXT NOT NULL DEFAULT 'customer',
    to_phone TEXT NOT NULL,
    body TEXT NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1,
    detail TEXT NOT NULL DEFAULT '',
    request_id INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_business ON messages (business_id, id)`,
  `CREATE TABLE IF NOT EXISTS cron_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // The business line's call log, both directions. `accepted` is set when the owner presses 1 on
  // the whisper, so a cell voicemail picking up still counts as a missed call.
  `CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    call_sid TEXT UNIQUE NOT NULL,
    direction TEXT NOT NULL DEFAULT 'in',
    from_number TEXT NOT NULL DEFAULT '',
    to_number TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    duration INTEGER NOT NULL DEFAULT 0,
    accepted INTEGER NOT NULL DEFAULT 0,
    missed INTEGER NOT NULL DEFAULT 0,
    texted_back INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_calls_business ON calls (business_id, id)`,
  // Uploaded pictures (chat photos, customer MMS, Google profile photos), kept in the database like
  // poster_images so nothing needs a storage bucket. Served publicly at /api/media/<key>; the key is unguessable.
  `CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    business_id INTEGER NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // The owner's chat with us (their account manager). sender = 'client' | 'team'.
  `CREATE TABLE IF NOT EXISTS team_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_messages ON team_messages (business_id, id)`,
  // Texts between the business line and its customers, one thread per phone. Every text we send
  // (review requests included) and every text that comes in lands here.
  `CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    direction TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    media_urls TEXT NOT NULL DEFAULT '[]',
    message_sid TEXT NOT NULL DEFAULT '',
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conversation ON conversation_messages (business_id, customer_phone, id)`,
  // Receipts, invoices and quotes written from a few words. The customer opens /d/<token>.
  `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL DEFAULT 'invoice',
    language TEXT NOT NULL DEFAULT 'en',
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Photos the owner uploads for their Google profile. They drip out one at a time (see lib/photos.ts).
  `CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    consent_text TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_consents_business ON consents (business_id, phone)`,
  `CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    service TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    consent INTEGER NOT NULL DEFAULT 0,
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_leads_business ON leads (business_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    gbp_media_name TEXT NOT NULL DEFAULT '',
    gbp_error TEXT NOT NULL DEFAULT '',
    gbp_attempts INTEGER NOT NULL DEFAULT 0,
    gbp_posted_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_photos_business ON photos (business_id, id)`,
  // Google's own daily numbers for a linked profile: how many people saw it and how many tapped Call.
  // Filled by lib/insights.ts (daily cron, plus a catch-up when a dashboard opens and the data is stale).
  `CREATE TABLE IF NOT EXISTS gbp_daily (
    business_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (business_id, date)
  )`,
  // The team. Each person signs in once per browser and stays in; what they do is theirs by name.
  `CREATE TABLE IF NOT EXISTS ops_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS ops_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Wrong admin passwords, so the sign-in can lock out a guesser.
  `CREATE TABLE IF NOT EXISTS admin_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // A friend an owner sent our way: they get a month free when the friend signs up, the friend gets half off.
  `CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    friend_name TEXT NOT NULL DEFAULT '',
    friend_business TEXT NOT NULL DEFAULT '',
    friend_phone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS weekly_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(business_id, week_start)
  )`,
  `CREATE TABLE IF NOT EXISTS meta_leads (
    leadgen_id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL DEFAULT '',
    form_id TEXT NOT NULL DEFAULT '',
    ad_id TEXT NOT NULL DEFAULT '',
    ad_name TEXT NOT NULL DEFAULT '',
    campaign_name TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    fields_json TEXT NOT NULL DEFAULT '{}',
    fetch_error TEXT NOT NULL DEFAULT '',
    alerted INTEGER NOT NULL DEFAULT 0,
    alert_detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Sales CRM (ops board "Sales"): every prospect is a deal, every call/text/note is a touch,
  // every booked call or reminder is an event. Meta leads flow in automatically via lead_id.
  `CREATE TABLE IF NOT EXISTS sales_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'manual',
    lead_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    business_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    trade TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'new',
    owner_key TEXT NOT NULL DEFAULT 'rep',
    value_cents INTEGER NOT NULL DEFAULT 29900,
    one_time_cents INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT NOT NULL DEFAULT '',
    next_follow_up TEXT NOT NULL DEFAULT '',
    lost_reason TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    last_touch_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS sales_deals_lead ON sales_deals(lead_id) WHERE lead_id != ''",
  `CREATE TABLE IF NOT EXISTS sales_touches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'note',
    body TEXT NOT NULL DEFAULT '',
    rep_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sales_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'call',
    title TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 30,
    rep_key TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Team tasks (ops board "Tasks"): a daily list first, a week at most. position orders rows inside a day/priority.
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    list TEXT NOT NULL DEFAULT '',
    assignee_key TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'open',
    due TEXT NOT NULL DEFAULT '',
    position REAL NOT NULL DEFAULT 0,
    done_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS tasks_open ON tasks(status, due)",
  // What a deal is worth, one line per thing sold: one-time or monthly. A deal with lines
  // keeps sales_deals.value_cents / one_time_cents equal to the sums (lib/sales.ts syncDealTotals).
  `CREATE TABLE IF NOT EXISTS sales_deal_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'monthly',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS sales_deal_items_deal ON sales_deal_items(deal_id)",
  // Pipeline columns, in board order. Seeded with the built-in stages on first read (lib/sales.ts);
  // built-in ones (builtin=1) can be renamed and reordered but not removed, because the
  // call outcomes and closes move deals into them by key.
  `CREATE TABLE IF NOT EXISTS sales_stages (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Meta leads deleted from the pipeline by hand; the sync skips these so they never come back.
  `CREATE TABLE IF NOT EXISTS sales_deleted_leads (
    lead_id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Our own iMessage lines (lib/imessage.ts): a BlueBubbles server on a Mac signed into the line's
  // Apple ID. Used for sales leads and for texting our clients, never for a client's customers.
  `CREATE TABLE IF NOT EXISTS imessage_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    webhook_secret TEXT NOT NULL DEFAULT '',
    daily_new_cap INTEGER NOT NULL DEFAULT 20,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Both the outbound queue and the thread log. direction 'out': queued → sent | failed | skipped.
  // direction 'in': status 'received'. run_key ties automated texts to the rule run that made them.
  `CREATE TABLE IF NOT EXISTS imessages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    direction TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    detail TEXT NOT NULL DEFAULT '',
    automated INTEGER NOT NULL DEFAULT 0,
    rule_id INTEGER NOT NULL DEFAULT 0,
    run_key TEXT NOT NULL DEFAULT '',
    guid TEXT NOT NULL DEFAULT '',
    rep_key TEXT NOT NULL DEFAULT '',
    scheduled_for TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_imessages_thread ON imessages (phone, id)",
  "CREATE INDEX IF NOT EXISTS idx_imessages_due ON imessages (status, scheduled_for)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_imessages_guid ON imessages (guid) WHERE guid != ''",
  // Automations on the iMessage line: when `trigger` fires, each step is queued `delay_minutes` after it.
  // sources: comma list of lead sources the rule applies to ('' = any). steps: JSON [{delay_minutes, body}].
  `CREATE TABLE IF NOT EXISTS imessage_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '',
    steps TEXT NOT NULL DEFAULT '[]',
    line_id INTEGER NOT NULL DEFAULT 0,
    stop_on_reply INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Who an iMessage thread belongs to, set by hand in Texts (overrides matching by phone).
  // kind 'lead' → deal_id (texts land in the deal's history), 'client' → business_id (texts land in
  // that client's Messages chat), 'other' → neither (personal, spam, wrong number).
  `CREATE TABLE IF NOT EXISTS imessage_contacts (
    phone TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    deal_id INTEGER NOT NULL DEFAULT 0,
    business_id INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // STOP on our iMessage line. Kept apart from opt_outs, which is per client business.
  `CREATE TABLE IF NOT EXISTS imessage_opt_outs (
    phone TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Client agreements (signature records). One signature per agreement;
  // terms_json is the exact text they signed, terms_hash its sha256.
  `CREATE TABLE IF NOT EXISTS contract_signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    signer_name TEXT NOT NULL,
    signer_title TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    terms_hash TEXT NOT NULL,
    terms_json TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    signed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

// Columns added after first launch. Each runs once; "duplicate column" is swallowed.
const MIGRATIONS: string[] = [
  // Team chat rows mirrored from our iMessage line (channel 'imessage', imessage_id → imessages.id).
  // The client's app only shows channel 'app'; ops sees both in the client's Messages thread.
  "ALTER TABLE team_messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'app'",
  "ALTER TABLE team_messages ADD COLUMN imessage_id INTEGER NOT NULL DEFAULT 0",
  // A name we gave the number in Texts. Shown for unfiled and "other" threads, and as the person on a client's thread.
  // (A lead's name is saved on the deal instead.) kind 'unknown' = named but not filed.
  "ALTER TABLE imessage_contacts ADD COLUMN name TEXT NOT NULL DEFAULT ''",
  // Skip this rule's queued texts once the lead has booked a call (checked right before each send).
  "ALTER TABLE imessage_rules ADD COLUMN stop_on_booking INTEGER NOT NULL DEFAULT 0",
  // 1 = this rule's texts also go out at night (no 8am to 8pm hold).
  "ALTER TABLE imessage_rules ADD COLUMN any_hour INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE businesses ADD COLUMN auto_reply INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE businesses ADD COLUMN monthly_limit INTEGER NOT NULL DEFAULT 100",
  "ALTER TABLE requests ADD COLUMN poster_url TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE requests ADD COLUMN step INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE requests ADD COLUMN next_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE requests ADD COLUMN stop_reason TEXT NOT NULL DEFAULT ''",
  // Rows from before sequences: queued ones are due at send_at, sent ones count as step 1 with no follow-ups.
  "UPDATE requests SET next_at = send_at WHERE status='queued' AND next_at='' AND step=0",
  "UPDATE requests SET step = 1 WHERE status IN ('sent','opened','reviewed') AND step=0",
  "CREATE INDEX IF NOT EXISTS idx_requests_next ON requests (next_at)",
  // Key into TEMPLATES in lib/poster-render.ts; '' = no sign photo, texts go out without an image.
  "ALTER TABLE businesses ADD COLUMN poster_template TEXT NOT NULL DEFAULT ''",
  // 0 = the text carries the business's Google review link as is (default). 1 = our /r/<code> link, which records the tap first.
  "ALTER TABLE businesses ADD COLUMN track_links INTEGER NOT NULL DEFAULT 0",
  // Picture for this step: a key in lib/poster-assets/templates.json. '' on step 1 falls back to the business's sign photo; '' later = words only.
  "ALTER TABLE sequence_steps ADD COLUMN poster_template TEXT NOT NULL DEFAULT ''",
  // The follow-up meme photo; used on step 2 when that step names no picture of its own.
  "ALTER TABLE businesses ADD COLUMN meme_template TEXT NOT NULL DEFAULT ''",
  // Per-client finances. Twilio reports the exact price of each text a little after it sends;
  // the costs cron copies it here. Until then a list-price estimate is used.
  "ALTER TABLE messages ADD COLUMN segments INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE messages ADD COLUMN media INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE messages ADD COLUMN price_usd REAL",
  "ALTER TABLE messages ADD COLUMN priced_at TEXT NOT NULL DEFAULT ''",
  // What a business costs us beyond texts: number + campaign per month, registration once. Cents.
  "ALTER TABLE businesses ADD COLUMN fixed_cost_cents INTEGER NOT NULL DEFAULT 265",
  "ALTER TABLE businesses ADD COLUMN setup_cost_cents INTEGER NOT NULL DEFAULT 2000",
  "CREATE INDEX IF NOT EXISTS idx_messages_priced ON messages (ok, priced_at)",
  // Optional features, switched per business in admin. A reviews-only client has them all at 0 and never sees them.
  "ALTER TABLE businesses ADD COLUMN feature_phone INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE businesses ADD COLUMN feature_invoices INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE businesses ADD COLUMN feature_messages INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE businesses ADD COLUMN feature_photos INTEGER NOT NULL DEFAULT 0",
  // 1 = sent by the review sequence (request + follow-ups). Hidden from the owner's inbox so it stays
  // real conversations; we still see every one in admin under messages.
  "ALTER TABLE conversation_messages ADD COLUMN automated INTEGER NOT NULL DEFAULT 0",
  "UPDATE conversation_messages SET automated=1 WHERE automated=0 AND direction='out' AND message_sid != '' AND message_sid IN (SELECT detail FROM messages WHERE request_id > 0)",
  // Which pushes the owner wants. Messages from us (the team chat) always go through; there is no switch for those.
  "ALTER TABLE businesses ADD COLUMN notify_texts INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE businesses ADD COLUMN notify_calls INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE businesses ADD COLUMN notify_reviews INTEGER NOT NULL DEFAULT 1",
  // The nudge to send job photos when the Google queue runs dry.
  "ALTER TABLE businesses ADD COLUMN notify_photos INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE businesses ADD COLUMN photo_nudged_at TEXT NOT NULL DEFAULT ''",
  // Last time we reminded the owner that no new customers have come in (at most every 14 days).
  "ALTER TABLE businesses ADD COLUMN customers_nudged_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN reviews_alerted_at TEXT NOT NULL DEFAULT ''",
  // The client's website: a Vercel deploy hook we POST when a new review lands (their build pulls
  // /api/public/reviews/<slug>), and the daily site check's last result (lib/sites.ts).
  "ALTER TABLE businesses ADD COLUMN site_deploy_hook TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN site_repo TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN site_ok INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE businesses ADD COLUMN site_detail TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN site_checked_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN demo INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE businesses ADD COLUMN website TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN lead_alert_phones TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN web_lead_text TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN insights_synced_at TEXT NOT NULL DEFAULT ''",
  // The business's own logo, shown on its receipts, invoices and quotes (page and PDF). A /api/media URL.
  "ALTER TABLE businesses ADD COLUMN logo_url TEXT NOT NULL DEFAULT ''",
  // The business's own colors on those documents (lib/brand.ts). Read from the logo on upload, editable in admin.
  "ALTER TABLE businesses ADD COLUMN brand_color TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN brand_accent TEXT NOT NULL DEFAULT ''",
  // Which of us is this owner's person in the team chat. Key into lib/reps.ts.
  "ALTER TABLE businesses ADD COLUMN rep_key TEXT NOT NULL DEFAULT 'rep'",
  // The business line: where it rings, for how long, what a missed caller gets texted, and the
  // Twilio pieces behind it (the number's SID and the TwiML App that in-app calls go out through).
  "ALTER TABLE businesses ADD COLUMN forward_to TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN ring_seconds INTEGER NOT NULL DEFAULT 20",
  "ALTER TABLE businesses ADD COLUMN missed_call_text TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN line_language TEXT NOT NULL DEFAULT 'en'",
  "ALTER TABLE businesses ADD COLUMN number_sid TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN twiml_app_sid TEXT NOT NULL DEFAULT ''",
  // Review gate: the link in the text can live on the business's own domain
  // (gate_url = https://theirsite.com/review, the site rewrites to our /r/).
  "ALTER TABLE businesses ADD COLUMN gate_url TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE requests ADD COLUMN stars INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE feedback ADD COLUMN stars INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE feedback ADD COLUMN name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE feedback ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
  // Reviews the name matcher could not link get one smarter pass (timing + Claude); this marks it done.
  "ALTER TABLE reviews ADD COLUMN match_checked INTEGER NOT NULL DEFAULT 0",
  // Quotes, invoices and receipts can live on the business's own domain too
  // (doc_url = https://theirsite.com/q, the site rewrites /q/:token to our /d/:token).
  "ALTER TABLE businesses ADD COLUMN doc_url TEXT NOT NULL DEFAULT ''",
  // Where this business's photos are geotagged when the phone did not record a location
  // ("lat, lng": the home base for a service-area business). Blank = photos go up untagged.
  "ALTER TABLE businesses ADD COLUMN photo_geo TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE leads ADD COLUMN source TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE leads ADD COLUMN gclid TEXT NOT NULL DEFAULT ''",
  // Launch handoff (lib/welcome.ts): the private welcome page token, the temporary password shown on it
  // until their first sign-in, and when we texted it / when they first opened it.
  "ALTER TABLE businesses ADD COLUMN welcome_token TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN welcome_password TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN welcome_sent_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE businesses ADD COLUMN welcome_opened_at TEXT NOT NULL DEFAULT ''",
  // 1 = forwarded calls show the business line as the caller instead of the customer's number,
  // so a saved contact gets past Silence Unknown Callers. The whisper still says who it is.
  "ALTER TABLE businesses ADD COLUMN ring_as_line INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE businesses ADD COLUMN ads_url TEXT NOT NULL DEFAULT ''",
];

// Fingerprint of everything above. A database that already carries this build's schema
// answers one SELECT and skips the ~90 statements, which used to run one at a time against
// Turso on every cold start (several seconds before the first real query).
const SCHEMA_HASH = createHash("sha1").update(JSON.stringify([SCHEMA, MIGRATIONS])).digest("hex").slice(0, 16);

async function init(client: Client) {
  try {
    const r = await client.execute("SELECT hash FROM schema_applied WHERE id=1");
    if (r.rows[0]?.hash === SCHEMA_HASH) return;
  } catch {
    /* no schema_applied table yet: first run on this database, apply everything */
  }
  for (const sql of SCHEMA) await client.execute(sql);
  for (const sql of MIGRATIONS) {
    try {
      await client.execute(sql);
    } catch (err) {
      if (!String(err).includes("duplicate column")) throw err;
    }
  }
  // Preview deployments with no real database: fill an empty DB with the demo business.
  if (process.env.DEMO_SEED === "true") {
    const r = await client.execute("SELECT COUNT(*) AS n FROM businesses");
    if (Number(r.rows[0]?.n ?? 0) === 0) {
      const { seedDemo } = await import("./seed-demo");
      console.log(await seedDemo(client));
    }
  }
  await client.execute("CREATE TABLE IF NOT EXISTS schema_applied (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  await client.execute({ sql: "INSERT INTO schema_applied (id, hash, applied_at) VALUES (1, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, applied_at=excluded.applied_at", args: [SCHEMA_HASH] });
}

export async function getDb(): Promise<Client> {
  if (!db) {
    const url = process.env.DATABASE_URL || "file:./data/happy-mouths.db";
    if (url.startsWith("file:")) {
      const p = url.slice(5);
      fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
    }
    db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
    ready = init(db);
  }
  await ready;
  return db;
}

export type Row = Record<string, unknown>;

/** Small helpers so call sites read like SQL, not like a driver. */
export type Arg = string | number | null | Uint8Array;
export async function one<T = Row>(sql: string, args: Arg[] = []): Promise<T | null> {
  const d = await getDb();
  const r = await d.execute({ sql, args });
  return (r.rows[0] as unknown as T) ?? null;
}
export async function all<T = Row>(sql: string, args: Arg[] = []): Promise<T[]> {
  const d = await getDb();
  const r = await d.execute({ sql, args });
  return r.rows as unknown as T[];
}
export async function run(sql: string, args: Arg[] = []): Promise<{ lastId: number; changes: number }> {
  const d = await getDb();
  const r = await d.execute({ sql, args });
  return { lastId: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
}

export async function logEvent(businessId: number, kind: string, detail = "") {
  await run("INSERT INTO events (business_id, kind, detail) VALUES (?,?,?)", [businessId, kind, detail]);
}
