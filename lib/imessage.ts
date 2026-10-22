// Our own iMessage line(s): blue-bubble texts to sales leads and to our clients, sent from a Mac
// running BlueBubbles Server (signed into the line's Apple ID) behind a Cloudflare tunnel.
// Apple has no API for iMessage, so BlueBubbles drives Messages.app for us.
//
// One table is both the queue and the thread log (imessages). Everything outbound goes through
// queueText(): manual sends from the Texts inbox and the automations in imessage_rules alike.
// drainQueue() sends what is due (cron every minute, plus a kick right after a manual send).
//
// Guard rails, because a line Apple flags as spam is blocked outright (that happened to the
// an Apple ID before):
//   - STOP / unsubscribe replies opt the number out (imessage_opt_outs); nothing is sent to it again.
//   - A daily cap on first-contact recipients per line (imessage_lines.daily_new_cap). Over the cap,
//     the text waits for the next day with room.
//   - Automated texts only go out 8am to 8pm Pacific; outside that they wait for 8am, unless the rule has any_hour.
//   - SMS_DRY_RUN=true logs instead of sending, like the Twilio side.

import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { all, one, run } from "./db";
import { normalizePhone, prettyPhone } from "./phone";
import { OPS_HOST, SITE } from "@/lib/whitelabel";

const TZ = "America/Los_Angeles";
const SEND_TIMEOUT_MS = 25_000;

export type Line = { id: number; label: string; url: string; password: string; webhook_secret: string; daily_new_cap: number; active: number; created_at: string };
export type IMessage = {
  id: number; line_id: number; phone: string; direction: "in" | "out"; body: string; status: string; detail: string;
  automated: number; rule_id: number; run_key: string; guid: string; rep_key: string; scheduled_for: string; sent_at: string | null; read_at: string | null; created_at: string;
};
export type Step = { delay_minutes: number; body: string };
export type Rule = { id: number; name: string; trigger: Trigger; sources: string; steps: string; line_id: number; stop_on_reply: number; stop_on_booking: number; any_hour: number; active: number; created_at: string };

export const TRIGGERS = [
  { key: "lead_new", label: "New lead comes in", hint: "Website form, Meta ad, sheet or a lead added by hand. Pick sources to narrow it." },
  { key: "client_new", label: "New client is added", hint: "When a client account is created in ops. Texts the owner's phone." },
] as const;
export type Trigger = (typeof TRIGGERS)[number]["key"];

/** The words a template can use. {first_name} falls back to "there" so "Hey {first_name}" never reads "Hey ". */
export const TEMPLATE_VARS = ["first_name", "name", "business", "trade", "city", "rep"] as const;

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/** SQLite's datetime('now') format, UTC. */
export const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

function pacificParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), minute: Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

/** UTC instant of the most recent Pacific midnight. */
function pacificMidnight(d = new Date()): Date {
  const { hour, minute } = pacificParts(d);
  return new Date(d.getTime() - (hour * 60 + minute) * 60_000 - d.getUTCSeconds() * 1000 - d.getUTCMilliseconds());
}

/** Next moment inside 8am to 8pm Pacific, or `d` itself when it already is. */
export function withinSendingHours(d: Date): Date {
  const { hour, minute } = pacificParts(d);
  if (hour >= 8 && hour < 20) return d;
  const minsTo8 = hour < 8 ? (8 - hour) * 60 - minute : (24 - hour + 8) * 60 - minute;
  return new Date(d.getTime() + minsTo8 * 60_000);
}

/* ------------------------------------------------------------------ */
/* Lines + the BlueBubbles REST API                                    */
/* ------------------------------------------------------------------ */

export const listLines = () => all<Line>("SELECT * FROM imessage_lines ORDER BY id");
export const getLine = (id: number) => one<Line>("SELECT * FROM imessage_lines WHERE id=?", [id]);
/** The line a text goes out on when nothing picks one: the first active line. */
export const defaultLine = () => one<Line>("SELECT * FROM imessage_lines WHERE active=1 ORDER BY id LIMIT 1");

export async function saveLine(o: { id?: number; label: string; url: string; password?: string; daily_new_cap: number; active: boolean }): Promise<number> {
  const url = o.url.trim().replace(/\/+$/, "");
  if (o.id) {
    await run("UPDATE imessage_lines SET label=?, url=?, daily_new_cap=?, active=? WHERE id=?", [o.label, url, o.daily_new_cap, o.active ? 1 : 0, o.id]);
    if (o.password) await run("UPDATE imessage_lines SET password=? WHERE id=?", [o.password, o.id]);
    return o.id;
  }
  const r = await run("INSERT INTO imessage_lines (label, url, password, webhook_secret, daily_new_cap, active) VALUES (?,?,?,?,?,?)", [
    o.label, url, o.password ?? "", randomBytes(16).toString("hex"), o.daily_new_cap, o.active ? 1 : 0,
  ]);
  return r.lastId;
}

export function webhookUrl(line: Line): string {
  const base = (process.env.BASE_URL ?? SITE).replace(/\/+$/, "");
  return `${base}/api/imessage/webhook/${line.id}/${line.webhook_secret}`;
}

async function bb<T = unknown>(line: Line, method: "GET" | "POST" | "DELETE", path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${line.url}${path}${sep}password=${encodeURIComponent(line.password)}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: { status?: number; message?: string; data?: unknown; error?: { message?: string } } = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not JSON: a tunnel error page */ }
  if (!res.ok) throw new Error(`BlueBubbles ${res.status}: ${parsed.error?.message ?? parsed.message ?? text.slice(0, 160)}`);
  return parsed.data as T;
}

export type LineHealth = { ok: boolean; detail: string; account?: string; version?: string; privateApi?: boolean; webhook?: boolean };

/** Is the Mac up, Messages signed in, and our webhook registered on it? */
export async function lineHealth(line: Line): Promise<LineHealth> {
  if (!line.url || !line.password) return { ok: false, detail: "Server URL or password missing" };
  try {
    const info = await bb<{ server_version: string; detected_imessage: string; private_api: boolean }>(line, "GET", "/api/v1/server/info", undefined, 8000);
    const hooks = await bb<{ url: string }[]>(line, "GET", "/api/v1/webhook", undefined, 8000).catch(() => []);
    const webhook = hooks.some((h) => h.url === webhookUrl(line));
    return { ok: true, detail: webhook ? "Connected" : "Server up, webhook not registered", account: info.detected_imessage, version: info.server_version, privateApi: info.private_api, webhook };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Registers our inbound webhook on the line's BlueBubbles server (new messages only). Idempotent. */
export async function registerWebhook(line: Line): Promise<void> {
  const hooks = await bb<{ id: number; url: string }[]>(line, "GET", "/api/v1/webhook");
  if (hooks.some((h) => h.url === webhookUrl(line))) return;
  await bb(line, "POST", "/api/v1/webhook", { url: webhookUrl(line), events: ["new-message"] });
}

/**
 * One text through Messages.app. /chat/new works for first contact and existing chats alike.
 * Apple-script sends hold the HTTP response open long after Messages has queued the text, so a
 * client-side timeout counts as "probably sent": retrying would double-text the person.
 */
async function bbSend(line: Line, phone: string, body: string): Promise<{ ok: boolean; detail: string }> {
  if (process.env.SMS_DRY_RUN === "true") {
    console.log(`[imessage dry-run] line ${line.id} → ${phone}: ${body}`);
    return { ok: true, detail: "dry-run" };
  }
  try {
    const data = await bb<{ guid?: string }>(line, "POST", "/api/v1/chat/new", { addresses: [phone], message: body, method: "apple-script", tempGuid: `hm-${randomBytes(8).toString("hex")}` }, SEND_TIMEOUT_MS);
    return { ok: true, detail: data?.guid ?? "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort|timeout/i.test(msg)) return { ok: true, detail: "sent (no confirmation before timeout)" };
    return { ok: false, detail: msg.slice(0, 300) };
  }
}

/* ------------------------------------------------------------------ */
/* Who is this number                                                  */
/* ------------------------------------------------------------------ */

export type Contact =
  | { kind: "client"; id: number; name: string; person: string; rep_key: string; assigned: boolean }
  | { kind: "lead"; id: number; name: string; person: string; rep_key: string; assigned: boolean; stage: string; source: string; trade: string; city: string }
  | { kind: "other" | "unknown"; id: 0; name: string; person: string; rep_key: string; assigned: boolean };

type ClientRow = { id: number; name: string; owner_name: string; rep_key: string };
type DealRow = { id: number; name: string; business_name: string; owner_key: string; stage: string; source: string; trade: string; city: string };
const asClient = (b: ClientRow, assigned: boolean): Contact => ({ kind: "client", id: Number(b.id), name: b.name, person: b.owner_name, rep_key: b.rep_key, assigned });
const asLead = (d: DealRow, assigned: boolean): Contact => ({ kind: "lead", id: Number(d.id), name: d.business_name || d.name, person: d.name, rep_key: d.owner_key, assigned, stage: d.stage, source: d.source, trade: d.trade, city: d.city });
const CLIENT_COLS = "id, name, owner_name, rep_key";
const DEAL_COLS = "id, name, business_name, owner_key, stage, source, trade, city";

/**
 * Who a number is. A thread assigned by hand in Texts wins. Otherwise a client (by owner phone)
 * wins over a lead with the same number, because a won deal becomes a client.
 */
export async function contactFor(rawPhone: string): Promise<Contact> {
  const phone = normalizePhone(rawPhone);
  const a = await one<{ kind: string; deal_id: number; business_id: number; name: string }>("SELECT kind, deal_id, business_id, name FROM imessage_contacts WHERE phone=?", [phone]);
  const named = a?.name ?? "";
  const withName = (c: Contact): Contact => (named && c.kind === "client" ? { ...c, person: named } : c);
  if (a?.kind === "client") {
    const b = await one<ClientRow>(`SELECT ${CLIENT_COLS} FROM businesses WHERE id=?`, [a.business_id]);
    if (b) return withName(asClient(b, true));
  } else if (a?.kind === "lead") {
    const d = await one<DealRow>(`SELECT ${DEAL_COLS} FROM sales_deals WHERE id=?`, [a.deal_id]);
    if (d) return asLead(d, true);
  } else if (a?.kind === "other") {
    return { kind: "other", id: 0, name: named || prettyPhone(phone), person: named, rep_key: "", assigned: true };
  }
  const b = await one<ClientRow>(`SELECT ${CLIENT_COLS} FROM businesses WHERE owner_phone=? AND demo=0 ORDER BY (status IN ('active','trial')) DESC, id DESC LIMIT 1`, [phone]);
  if (b) return withName(asClient(b, false));
  const d = await one<DealRow>(`SELECT ${DEAL_COLS} FROM sales_deals WHERE phone=? ORDER BY id DESC LIMIT 1`, [phone]);
  if (d) return asLead(d, false);
  return { kind: "unknown", id: 0, name: named || prettyPhone(phone), person: named, rep_key: "", assigned: false };
}

/**
 * Names the person behind a number. A lead's name goes on their deal (so Sales shows it too);
 * anyone else's is kept with the number in imessage_contacts.
 */
export async function setContactName(rawPhone: string, rawName: string): Promise<void> {
  const phone = normalizePhone(rawPhone);
  const name = rawName.trim().slice(0, 80);
  const who = await contactFor(phone);
  if (who.kind === "lead") {
    await run("UPDATE sales_deals SET name=?, updated_at=datetime('now') WHERE id=?", [name, who.id]);
    return;
  }
  await run(
    "INSERT INTO imessage_contacts (phone, kind, name, updated_at) VALUES (?,'unknown',?,datetime('now')) ON CONFLICT(phone) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at",
    [phone, name]
  );
}

/**
 * A client's iMessage texts also live in that client's Messages chat (team_messages, channel
 * 'imessage'), so client communication is in one place. Once per iMessage row.
 */
async function mirrorToClient(imessageId: number) {
  const m = await one<IMessage>("SELECT * FROM imessages WHERE id=?", [imessageId]);
  if (!m || (m.status !== "sent" && m.status !== "received")) return;
  const who = await contactFor(m.phone);
  if (who.kind !== "client") return;
  if (await one("SELECT 1 AS x FROM team_messages WHERE imessage_id=?", [m.id])) return;
  const inbound = m.direction === "in";
  await run("INSERT INTO team_messages (business_id, sender, body, channel, imessage_id, read_at, created_at) VALUES (?,?,?,?,?,?,?)", [
    who.id, inbound ? "client" : "team", m.body, "imessage", m.id, inbound ? m.read_at : (m.sent_at ?? m.created_at), inbound ? m.created_at : (m.sent_at ?? m.created_at),
  ]);
}

/** The phone a lead's iMessages go to: the deal's own number, else a thread assigned to the deal. */
export async function dealIMessagePhone(dealId: number, dealPhone: string): Promise<string> {
  if (dealPhone) return normalizePhone(dealPhone);
  const a = await one<{ phone: string }>("SELECT phone FROM imessage_contacts WHERE kind='lead' AND deal_id=? ORDER BY updated_at DESC LIMIT 1", [dealId]);
  return a?.phone ?? "";
}

/** The phone a client's iMessages go to: a thread assigned to them, else the owner's cell. */
export async function clientIMessagePhone(businessId: number): Promise<string> {
  const a = await one<{ phone: string }>("SELECT phone FROM imessage_contacts WHERE kind='client' AND business_id=? ORDER BY updated_at DESC LIMIT 1", [businessId]);
  if (a) return a.phone;
  const b = await one<{ owner_phone: string }>("SELECT owner_phone FROM businesses WHERE id=?", [businessId]);
  return b?.owner_phone ? normalizePhone(b.owner_phone) : "";
}

export type AssignTarget = { kind: "lead"; dealId: number | "new" } | { kind: "client"; businessId: number } | { kind: "other" } | { kind: "auto" };

/**
 * Files a thread under a lead (its texts go to the deal's history in Sales) or a client (its texts
 * go to that client's Messages chat), or out of the way ("other"). "auto" clears it back to
 * matching by phone. Returns the deal id when a lead was made or linked.
 */
export async function assignThread(rawPhone: string, target: AssignTarget, repKey = ""): Promise<{ dealId?: number }> {
  const phone = normalizePhone(rawPhone);
  if (target.kind === "auto") {
    // Back to matching by phone; a name we gave the number stays.
    await run("UPDATE imessage_contacts SET kind='unknown', deal_id=0, business_id=0, updated_at=datetime('now') WHERE phone=?", [phone]);
    return {};
  }
  let dealId = 0, businessId = 0;
  if (target.kind === "lead") {
    if (target.dealId === "new") {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
      const named = await one<{ name: string }>("SELECT name FROM imessage_contacts WHERE phone=?", [phone]);
      dealId = (await run("INSERT INTO sales_deals (source, name, phone, stage, owner_key, next_follow_up) VALUES ('imessage',?,?,'new',?,?)", [named?.name ?? "", phone, repKey || "rep", today])).lastId;
      await run("INSERT INTO sales_touches (deal_id, kind, body, rep_key) VALUES (?,?,?,?)", [dealId, "system", "Texted our iMessage line; filed as a lead from Texts", repKey]);
    } else {
      dealId = target.dealId;
      await run("UPDATE sales_deals SET phone=? WHERE id=? AND phone=''", [phone, dealId]);
      await run("INSERT INTO sales_touches (deal_id, kind, body, rep_key) VALUES (?,?,?,?)", [dealId, "system", `iMessage thread with ${prettyPhone(phone)} linked from Texts`, repKey]);
    }
  } else if (target.kind === "client") {
    businessId = target.businessId;
  }
  await run(
    "INSERT INTO imessage_contacts (phone, kind, deal_id, business_id, updated_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(phone) DO UPDATE SET kind=excluded.kind, deal_id=excluded.deal_id, business_id=excluded.business_id, updated_at=excluded.updated_at",
    [phone, target.kind, dealId, businessId]
  );
  if (target.kind === "client") {
    // Bring the thread so far into the client's chat, in order.
    for (const r of await all<{ id: number }>("SELECT id FROM imessages WHERE phone=? AND status IN ('sent','received') ORDER BY id", [phone])) await mirrorToClient(Number(r.id));
  }
  return dealId ? { dealId } : {};
}

/** Leads and clients a thread can be filed under, for the Assign menu in Texts. */
export async function assignOptions(): Promise<{ leads: { id: number; label: string }[]; clients: { id: number; label: string }[] }> {
  const leads = await all<{ id: number; name: string; business_name: string; phone: string }>("SELECT id, name, business_name, phone FROM sales_deals WHERE stage != 'lost' ORDER BY id DESC LIMIT 300");
  const clients = await all<{ id: number; name: string; owner_name: string }>("SELECT id, name, owner_name FROM businesses WHERE demo=0 AND status IN ('active','trial') ORDER BY name");
  return {
    leads: leads.map((l) => ({ id: Number(l.id), label: [l.name, l.business_name].filter(Boolean).join(" · ") || (l.phone ? prettyPhone(l.phone) : `#${l.id}`) })),
    clients: clients.map((c) => ({ id: Number(c.id), label: `${c.name}${c.owner_name ? ` · ${c.owner_name}` : ""}` })),
  };
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export const isOptedOut = async (phone: string) => Boolean(await one("SELECT 1 AS x FROM imessage_opt_outs WHERE phone=?", [normalizePhone(phone)]));

export async function queueText(o: {
  phone: string; body: string; lineId?: number; at?: Date; automated?: boolean; ruleId?: number; runKey?: string; repKey?: string;
}): Promise<{ ok: boolean; id?: number; detail: string }> {
  const phone = normalizePhone(o.phone);
  const body = o.body.trim();
  if (!/^\+\d{10,15}$/.test(phone)) return { ok: false, detail: "That phone number looks off." };
  if (!body) return { ok: false, detail: "Nothing to send." };
  if (await isOptedOut(phone)) return { ok: false, detail: "This number texted STOP." };
  const line = o.lineId ? await getLine(o.lineId) : await defaultLine();
  if (!line) return { ok: false, detail: "No iMessage line is set up yet (Texts → Settings)." };
  const at = o.at ?? new Date();
  const r = await run(
    "INSERT INTO imessages (line_id, phone, direction, body, status, automated, rule_id, run_key, rep_key, scheduled_for) VALUES (?,?,'out',?,'queued',?,?,?,?,?)",
    [line.id, phone, body.slice(0, 2000), o.automated ? 1 : 0, o.ruleId ?? 0, o.runKey ?? "", o.repKey ?? "", sqlTime(at)]
  );
  return { ok: true, id: r.lastId, detail: "queued" };
}

/** First-contact recipients the line has sent to since Pacific midnight. */
async function newRecipientsToday(lineId: number): Promise<number> {
  const since = sqlTime(pacificMidnight());
  const r = await one<{ n: number }>(
    `SELECT COUNT(DISTINCT m.phone) AS n FROM imessages m
     WHERE m.line_id=? AND m.direction='out' AND m.status='sent' AND m.sent_at >= ?
       AND NOT EXISTS (SELECT 1 FROM imessages p WHERE p.line_id=m.line_id AND p.phone=m.phone AND p.created_at < ? AND (p.status='sent' OR p.direction='in'))`,
    [lineId, since, since]
  );
  return Number(r?.n ?? 0);
}

const hasHistory = async (lineId: number, phone: string) =>
  Boolean(await one("SELECT 1 AS x FROM imessages WHERE line_id=? AND phone=? AND (status='sent' OR direction='in') LIMIT 1", [lineId, phone]));

/** Sends what is due, oldest first. Each row is claimed before sending so two drains never double-send. */
export async function drainQueue(limit = 8): Promise<{ sent: number; failed: number; deferred: number; skipped: number }> {
  const out = { sent: 0, failed: 0, deferred: 0, skipped: 0 };
  const due = await all<IMessage>("SELECT * FROM imessages WHERE status='queued' AND scheduled_for <= ? ORDER BY scheduled_for, id LIMIT ?", [sqlTime(new Date()), limit]);
  const lines = new Map<number, Line | null>();
  for (const m of due) {
    if (!lines.has(m.line_id)) lines.set(m.line_id, await getLine(m.line_id));
    const line = lines.get(m.line_id);
    const skip = async (why: string) => { await run("UPDATE imessages SET status='skipped', detail=? WHERE id=? AND status='queued'", [why, m.id]); out.skipped++; };
    const later = async (at: Date, why: string) => { await run("UPDATE imessages SET scheduled_for=?, detail=? WHERE id=? AND status='queued'", [sqlTime(at), why, m.id]); out.deferred++; };

    if (!line || !line.active) { await skip("line is off"); continue; }
    if (await isOptedOut(m.phone)) { await skip("texted STOP"); continue; }
    const rule = m.automated && m.rule_id ? await one<{ stop_on_booking: number; any_hour: number }>("SELECT stop_on_booking, any_hour FROM imessage_rules WHERE id=?", [m.rule_id]) : null;
    if (rule?.stop_on_booking && (await bookedCall(m))) { await skip("booked a call"); continue; }
    if (m.automated && !rule?.any_hour) {
      const ok = withinSendingHours(new Date());
      // Keep a step's own short wait after 8am, so an overnight lead's 0-minute and 7-minute texts don't land together.
      const gap = Math.min(60 * 60_000, Math.max(0, new Date(m.scheduled_for.replace(" ", "T") + "Z").getTime() - new Date(m.created_at.replace(" ", "T") + "Z").getTime()));
      if (ok.getTime() > Date.now()) { await later(new Date(ok.getTime() + gap), "waiting for 8am Pacific"); continue; }
    }
    if (!(await hasHistory(line.id, m.phone)) && (await newRecipientsToday(line.id)) >= line.daily_new_cap) {
      await later(withinSendingHours(new Date(pacificMidnight().getTime() + 24 * 3600_000)), `daily new-contact cap (${line.daily_new_cap}) reached`);
      continue;
    }

    const claim = await run("UPDATE imessages SET status='sending' WHERE id=? AND status='queued'", [m.id]);
    if (!claim.changes) continue;
    const r = await bbSend(line, m.phone, m.body);
    await run("UPDATE imessages SET status=?, detail=?, sent_at=CASE WHEN ?='sent' THEN datetime('now') ELSE sent_at END WHERE id=?", [r.ok ? "sent" : "failed", r.detail, r.ok ? "sent" : "failed", m.id]);
    if (r.ok) {
      out.sent++;
      await logOnDeal(m.phone, "text", `${m.automated ? "Auto-text" : "Texted"} (iMessage): ${m.body}`, m.rep_key);
      await mirrorToClient(m.id);
    } else out.failed++;
  }
  // Rows stuck in 'sending' (the function died mid-send) are treated as sent, never re-sent.
  await run("UPDATE imessages SET status='sent', detail='sent (unconfirmed)', sent_at=COALESCE(sent_at, datetime('now')) WHERE status='sending' AND scheduled_for < datetime('now','-10 minutes')");
  return out;
}

/**
 * For rules with stop_on_booking: has this lead booked a call since the text was queued?
 * Only bookings logged on the deal count.
 */
async function bookedCall(m: IMessage): Promise<boolean> {
  const d = await one<{ id: number; name: string; email: string }>("SELECT id, name, email FROM sales_deals WHERE phone=? ORDER BY id DESC LIMIT 1", [m.phone]);
  if (d && (await one("SELECT 1 AS x FROM sales_touches WHERE deal_id=? AND body LIKE 'Booked %' LIMIT 1", [d.id]))) return true;
  return false;
}

/** Pending automated texts to this number stop when they reply (rules with stop_on_reply). */
async function stopSequences(phone: string, why: string) {
  await run(
    "UPDATE imessages SET status='skipped', detail=? WHERE phone=? AND status='queued' AND automated=1 AND (rule_id=0 OR rule_id IN (SELECT id FROM imessage_rules WHERE stop_on_reply=1))",
    [why, phone]
  );
}

export async function cancelQueued(id: number) {
  await run("UPDATE imessages SET status='skipped', detail='canceled by hand' WHERE id=? AND status='queued'", [id]);
}

/** The text shows up in the lead's history on their deal page, like a logged touch. */
async function logOnDeal(phone: string, kind: string, body: string, repKey = "") {
  const who = await contactFor(phone);
  if (who.kind !== "lead") return;
  const d = { id: who.id };
  await run("INSERT INTO sales_touches (deal_id, kind, body, rep_key) VALUES (?,?,?,?)", [d.id, kind, body.slice(0, 1000), repKey]);
  await run("UPDATE sales_deals SET last_touch_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [d.id]);
}

/* ------------------------------------------------------------------ */
/* Inbound (the BlueBubbles webhook)                                   */
/* ------------------------------------------------------------------ */

type BBMessage = {
  guid?: string; text?: string | null; isFromMe?: boolean; handle?: { address?: string } | null;
  chats?: { guid?: string; chatIdentifier?: string }[]; attachments?: { mimeType?: string | null; transferName?: string }[];
  associatedMessageGuid?: string | null; associatedMessageType?: number | string | null; dateCreated?: number;
};

const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|stop texting( me)?)\s*[.!]*\s*$/i;

/** Returns what happened, for the webhook's response and logs. */
export async function handleInbound(line: Line, msg: BBMessage, alert: (text: string) => Promise<unknown>): Promise<string> {
  // Tapbacks ("Loved …") arrive as messages; they are reactions, not texts.
  if (msg.associatedMessageGuid || (msg.associatedMessageType != null && msg.associatedMessageType !== 0 && msg.associatedMessageType !== "")) return "reaction";
  const chat = msg.chats?.[0];
  if (chat?.guid?.includes(";+;")) return "group chat";
  const address = msg.isFromMe ? chat?.chatIdentifier ?? chat?.guid?.split(";-;")[1] ?? "" : msg.handle?.address ?? "";
  if (!address || address.includes("@")) return "no phone";
  const phone = normalizePhone(address);
  const photos = (msg.attachments ?? []).filter((a) => (a.mimeType ?? "").startsWith("image/")).length;
  const body = (msg.text ?? "").replace(/￼/g, "").trim() || (photos ? "[photo]" : (msg.attachments?.length ? "[attachment]" : ""));
  if (!body) return "empty";
  if (msg.guid && (await one("SELECT 1 AS x FROM imessages WHERE guid=?", [msg.guid]))) return "duplicate";

  if (msg.isFromMe) {
    // Our own send echoing back, or someone texting from the line's iPhone/Mac directly.
    // Ours: stamp its guid. Typed on the phone: log it so the thread stays whole.
    const ours = await one<{ id: number }>(
      "SELECT id FROM imessages WHERE line_id=? AND phone=? AND direction='out' AND status IN ('sent','sending') AND guid='' AND body=? AND created_at > datetime('now','-30 minutes') ORDER BY id DESC LIMIT 1",
      [line.id, phone, body]
    );
    if (ours) await run("UPDATE imessages SET guid=? WHERE id=?", [msg.guid ?? "", ours.id]);
    else {
      const r = await run("INSERT OR IGNORE INTO imessages (line_id, phone, direction, body, status, detail, guid, sent_at, read_at) VALUES (?,?,'out',?,'sent','sent from the phone',?,datetime('now'),datetime('now'))", [line.id, phone, body, msg.guid ?? ""]);
      if (r.changes) await mirrorToClient(r.lastId);
    }
    return ours ? "echo" : "sent from phone";
  }

  // Alert at most once per conversation burst, not on every message.
  const recent = await one("SELECT 1 AS x FROM imessages WHERE phone=? AND direction='in' AND created_at > datetime('now','-15 minutes')", [phone]);
  const saved = await run("INSERT OR IGNORE INTO imessages (line_id, phone, direction, body, status, guid) VALUES (?,?,'in',?,'received',?)", [line.id, phone, body.slice(0, 4000), msg.guid ?? ""]);

  if (STOP_WORDS.test(body)) {
    await run("INSERT OR IGNORE INTO imessage_opt_outs (phone) VALUES (?)", [phone]);
    await run("UPDATE imessages SET status='skipped', detail='texted STOP' WHERE phone=? AND status='queued'", [phone]);
    await logOnDeal(phone, "system", "Texted STOP on iMessage. No more texts go to this number.");
    return "opted out";
  }

  await stopSequences(phone, "they replied");
  const who = await contactFor(phone);
  if (saved.changes) await mirrorToClient(saved.lastId);
  await logOnDeal(phone, "text", `Replied (iMessage): ${body}`);
  if (!recent) {
    const label = who.kind === "client" ? `Client ${who.name}` : who.kind === "lead" ? `Lead ${who.person || who.name}${who.name && who.person && who.name !== who.person ? ` (${who.name})` : ""}` : `New number ${prettyPhone(phone)}`;
    const where = who.kind === "client" ? `${OPS_HOST}/admin/chat?business=${who.id}` : `${OPS_HOST}/admin/texts?phone=${encodeURIComponent(phone)}`;
    if (who.kind !== "other") await alert(`iMessage from ${label}: "${body.slice(0, 200)}" Reply at ${where}`).catch(() => 0);
  }
  return who.kind === "unknown" ? "received (unknown number)" : `received (${who.kind} ${who.id})`;
}

/* ------------------------------------------------------------------ */
/* Inbox                                                               */
/* ------------------------------------------------------------------ */

export type TextThread = { phone: string; contact: Contact; unread: number; last_body: string; last_direction: string; last_status: string; last_at: string };

export async function listTextThreads(q = ""): Promise<TextThread[]> {
  const term = q.trim().toLowerCase().replace(/[%_]/g, "");
  const rows = await all<{ phone: string; unread: number; body: string; direction: string; status: string; created_at: string }>(
    `SELECT t.phone, t.unread, m.body, m.direction, m.status, m.created_at
     FROM (SELECT phone, MAX(id) AS last_id, SUM(CASE WHEN direction='in' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
           FROM imessages WHERE status != 'skipped' GROUP BY phone) t
     JOIN imessages m ON m.id = t.last_id
     ORDER BY t.last_id DESC LIMIT 200`
  );
  const threads = await Promise.all(rows.map(async (r) => ({
    phone: r.phone, contact: await contactFor(r.phone), unread: Number(r.unread), last_body: r.body, last_direction: r.direction, last_status: r.status, last_at: r.created_at,
  })));
  if (!term) return threads;
  const digits = term.replace(/\D/g, "");
  return threads.filter((t) => `${t.contact.name} ${t.contact.person}`.toLowerCase().includes(term) || (digits.length >= 3 && t.phone.includes(digits)) || t.last_body.toLowerCase().includes(term));
}

/** Plain objects (not libSQL rows), so pages can hand them straight to client components. */
export const textThread = async (phone: string, after = 0): Promise<IMessage[]> =>
  (await all<IMessage>("SELECT * FROM imessages WHERE phone=? AND id > ? ORDER BY id LIMIT 500", [normalizePhone(phone), after])).map((r) => ({
    id: Number(r.id), line_id: Number(r.line_id), phone: r.phone, direction: r.direction, body: r.body, status: r.status, detail: r.detail,
    automated: Number(r.automated), rule_id: Number(r.rule_id), run_key: r.run_key, guid: r.guid, rep_key: r.rep_key,
    scheduled_for: r.scheduled_for, sent_at: r.sent_at, read_at: r.read_at, created_at: r.created_at,
  }));

export async function markTextsRead(rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  await run("UPDATE imessages SET read_at=datetime('now') WHERE phone=? AND direction='in' AND read_at IS NULL", [phone]);
  await run("UPDATE team_messages SET read_at=datetime('now') WHERE read_at IS NULL AND imessage_id IN (SELECT id FROM imessages WHERE phone=?)", [phone]);
}

/** Read in the client's Messages chat counts as read in Texts too. */
export async function markClientTextsRead(businessId: number) {
  await run("UPDATE imessages SET read_at=datetime('now') WHERE direction='in' AND read_at IS NULL AND id IN (SELECT imessage_id FROM team_messages WHERE business_id=? AND imessage_id > 0)", [businessId]);
}

/** Unread texts from leads and unfiled numbers. Client texts count under Messages instead; "other" not at all. */
export async function unreadTexts(): Promise<number> {
  const rows = await all<{ phone: string; n: number }>("SELECT phone, COUNT(*) AS n FROM imessages WHERE direction='in' AND read_at IS NULL GROUP BY phone");
  let n = 0;
  for (const r of rows) {
    const who = await contactFor(r.phone);
    if (who.kind === "lead" || who.kind === "unknown") n += Number(r.n);
  }
  return n;
}

/** Leads and clients with a phone, for the "new text" picker. */
export async function textablePeople(): Promise<{ phone: string; label: string; kind: "lead" | "client" }[]> {
  const clients = await all<{ owner_phone: string; name: string; owner_name: string }>("SELECT owner_phone, name, owner_name FROM businesses WHERE demo=0 AND owner_phone != '' AND status IN ('active','trial') ORDER BY name");
  const leads = await all<{ phone: string; name: string; business_name: string }>("SELECT phone, name, business_name FROM sales_deals WHERE phone != '' AND stage NOT IN ('won','lost') ORDER BY id DESC LIMIT 300");
  return [
    ...clients.map((c) => ({ phone: c.owner_phone, label: `${c.name}${c.owner_name ? ` · ${c.owner_name}` : ""}`, kind: "client" as const })),
    ...leads.map((l) => ({ phone: l.phone, label: [l.name, l.business_name].filter(Boolean).join(" · ") || prettyPhone(l.phone), kind: "lead" as const })),
  ];
}

/* ------------------------------------------------------------------ */
/* Automations                                                         */
/* ------------------------------------------------------------------ */

export const listRules = () => all<Rule>("SELECT * FROM imessage_rules ORDER BY id");
export function parseSteps(v: string): Step[] {
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a.map((s) => ({ delay_minutes: Math.max(0, Number(s.delay_minutes) || 0), body: String(s.body ?? "") })).filter((s) => s.body.trim()) : [];
  } catch {
    return [];
  }
}

export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m)).replace(/[ \t]+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

const firstName = (s: string) => s.trim().split(/\s+/)[0] ?? "";

/**
 * The deal's trade as it reads mid-sentence ("your roofing jobs"). The website form's picks
 * map to a word; "Something else" and anything unknown (the booking page files its website
 * answer here) become "", which the template collapses to "your jobs".
 */
function tradeWord(trade: string): string {
  const t = trade.trim().toLowerCase();
  if (t === "hvac") return "HVAC";
  if (t.startsWith("landscaping")) return "landscaping";
  return ["roofing", "plumbing", "electrical", "cleaning", "remodeling"].includes(t) ? t : "";
}

export type Subject = { kind: "deal"; id: number } | { kind: "client"; id: number };

/**
 * Something happened (a new lead, a new client): queue every active rule's steps for it, once per
 * rule and subject. Never throws, so the lead form or the client page never fails over a text.
 */
export async function fireTrigger(trigger: Trigger, subject: Subject): Promise<number> {
  try {
    const rules = (await all<Rule>("SELECT * FROM imessage_rules WHERE trigger=? AND active=1", [trigger]));
    if (!rules.length) return 0;
    let phone = "", source = "", repKey = "";
    let vars: Record<string, string> = {};
    if (subject.kind === "deal") {
      const d = await one<{ name: string; business_name: string; phone: string; trade: string; city: string; source: string; owner_key: string }>("SELECT * FROM sales_deals WHERE id=?", [subject.id]);
      if (!d) return 0;
      phone = d.phone; source = d.source; repKey = d.owner_key;
      vars = { first_name: firstName(d.name) || "there", name: d.name || "there", business: d.business_name || "your business", trade: tradeWord(d.trade), city: d.city || "" };
    } else {
      const b = await one<{ name: string; owner_name: string; owner_phone: string; rep_key: string; demo: number }>("SELECT * FROM businesses WHERE id=?", [subject.id]);
      if (!b || b.demo) return 0;
      phone = b.owner_phone; repKey = b.rep_key;
      vars = { first_name: firstName(b.owner_name) || "there", name: b.owner_name || "there", business: b.name, trade: "", city: "" };
    }
    if (!phone) return 0;
    const { repFor } = await import("./reps");
    vars.rep = repFor(repKey).name;
    let queued = 0;
    for (const rule of rules) {
      const sources = rule.sources.split(",").map((s) => s.trim()).filter(Boolean);
      if (subject.kind === "deal" && sources.length && !sources.includes(source)) continue;
      const runKey = `${rule.id}:${subject.kind}:${subject.id}`;
      if (await one("SELECT 1 AS x FROM imessages WHERE run_key=? LIMIT 1", [runKey])) continue;
      let at = Date.now();
      for (const step of parseSteps(rule.steps)) {
        at += step.delay_minutes * 60_000;
        const r = await queueText({ phone, body: fillTemplate(step.body, vars), lineId: rule.line_id || undefined, at: new Date(at), automated: true, ruleId: rule.id, runKey, repKey });
        if (r.ok) queued++;
      }
    }
    return queued;
  } catch (err) {
    console.error("[imessage] fireTrigger", trigger, subject, err);
    return 0;
  }
}

/** Sends what is due once the response has gone out, so an instant text does not wait for the cron. */
export function kickDrain() {
  try {
    after(() => drainQueue(4).then(() => undefined).catch((err) => console.error("[imessage] drain", err)));
  } catch {
    /* outside a request (a script): the cron picks it up */
  }
}

/** Fires the trigger and, when it queued anything, kicks the drain. */
export async function fireAndSend(trigger: Trigger, subject: Subject): Promise<void> {
  if ((await fireTrigger(trigger, subject)) > 0) kickDrain();
}
