import Link from "next/link";
import { redirect } from "next/navigation";
import { all, one } from "@/lib/db";
import { isAdmin, type Business } from "@/lib/auth";
import { updateBusiness, impersonate, syncNow, clearBusinessData, createIntegration, deleteIntegration, saveSequence, blockContact, unblockContact, setupPhoneLine, setupTexting, replyTeamChat, saveLogo, saveBrandColors, sendWelcomeAction } from "../actions";
import { getSteps } from "@/lib/sequence";
import { PROVIDERS, PROVIDER_LABELS, PROVIDER_HELP } from "@/lib/integrations";
import { baseUrl } from "@/lib/template";
import { listBlocked } from "@/lib/dnc";
import { TEMPLATES } from "@/lib/poster-render";
import { PosterSetup } from "./PosterSetup";
import { prettyPhone } from "@/lib/phone";
import { REPS } from "@/lib/reps";
import { resolveBrand } from "@/lib/brand";
import { tr } from "@/lib/i18n-server";
import { launchChecks, pacific, welcomeUrl, type WelcomeBusiness } from "@/lib/welcome";
import { BRAND, NAME } from "@/lib/whitelabel";

export const dynamic = "force-dynamic";

function Field({ name, label, value, type = "text", hint }: { name: string; label: string; value: string | number; type?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-ink-soft">{label}</span>
      <input name={name} type={type} defaultValue={value} className="field mt-1" />
      {hint && <span className="mt-1 block text-xs text-ink-mute">{hint}</span>}
    </label>
  );
}

export default async function BusinessAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; sync?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await tr();
  const { id } = await params;
  const { saved, sync } = await searchParams;
  const b = await one<Business & { password_hash: string }>("SELECT * FROM businesses WHERE id=?", [Number(id)]);
  if (!b) redirect("/admin");
  const events = await all<{ kind: string; detail: string; created_at: string }>("SELECT kind, detail, created_at FROM events WHERE business_id=? ORDER BY id DESC LIMIT 30", [b.id]);
  const integrations = await all<{ id: number; provider: string; token: string; events: number; enabled: number; signing_secret: string; last_event_at: string }>("SELECT id, provider, token, events, enabled, signing_secret, last_event_at FROM integrations WHERE business_id=?", [b.id]);
  const messages = await all<{ lane: string; to_phone: string; body: string; ok: number; detail: string; created_at: string }>(
    "SELECT lane, to_phone, body, ok, detail, created_at FROM messages WHERE business_id=? ORDER BY id DESC LIMIT 40", [b.id]
  );
  const unreplied = await one<{ n: number }>("SELECT COUNT(*) AS n FROM reviews WHERE business_id=? AND reply_comment='' AND review_name NOT LIKE 'accounts/demo/%' AND created_at < datetime('now','-2 hours')", [b.id]);
  const chat = await all<{ sender: string; body: string; image_url: string; created_at: string }>("SELECT sender, body, image_url, created_at FROM (SELECT * FROM team_messages WHERE business_id=? ORDER BY id DESC LIMIT 60) ORDER BY id ASC", [b.id]);
  const photos = await one<{ waiting: number; posted: number }>("SELECT SUM(status != 'posted') AS waiting, SUM(status = 'posted') AS posted FROM photos WHERE business_id=?", [b.id]);
  const steps = await getSteps(b.id);
  const blocked = await listBlocked(b.id);
  // Photos the client sent from their finish page (kind sign-sent / caption-sent), newest first.
  const sentRows = await all<{ id: number; kind: string }>("SELECT id, kind FROM poster_images WHERE business_id=? AND kind IN ('sign-sent','caption-sent') ORDER BY id DESC", [b.id]).catch(() => []);
  const sentPhotos = { sign: sentRows.find((r) => r.kind === "sign-sent")?.id ?? 0, caption: sentRows.find((r) => r.kind === "caption-sent")?.id ?? 0 };
  const scheduled = await all<{ name: string; phone: string; next_at: string; step: number }>(
    "SELECT c.name, c.phone, r.next_at, r.step FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.business_id=? AND r.next_at != '' ORDER BY r.next_at LIMIT 25", [b.id]
  );
  const active = await one<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE business_id=? AND next_at != ''", [b.id]);
  const launch = await launchChecks(b as unknown as WelcomeBusiness);
  const w = b as unknown as WelcomeBusiness;
  const ready = launch.every((c) => c.ok);
  const usedThisMonth = await one<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE business_id=? AND status != 'queued' AND strftime('%Y-%m', sent_at) = strftime('%Y-%m', 'now')", [b.id]);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <Link href="/admin/clients" className="text-sm text-ink-soft hover:text-ink">{t("← Clients")}</Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {b.logo_url && <img src={b.logo_url} alt="" className="h-11 w-11 rounded-lg border border-line-strong object-contain" />}
          <h1 className="text-2xl font-extrabold tracking-tight">{b.name}</h1>
        </div>
        <div className="flex gap-2">
          <form action={syncNow}><input type="hidden" name="id" value={b.id} /><button className="btn btn-ghost h-10 text-sm">{t("Sync Google reviews")}</button></form>
          <Link href={`/admin/reviews?business=${b.id}`} className="btn btn-ghost h-10 text-sm">{Number(unreplied?.n ?? 0) ? t("Reviews ({n} unanswered)", { n: Number(unreplied?.n) }) : t("Reviews")}</Link>
          <form action={impersonate}><input type="hidden" name="id" value={b.id} /><button className="btn btn-ink h-10 text-sm">{t("Open their dashboard")}</button></form>
          <Link href={`/admin/${b.id}/delete`} className="btn btn-ghost h-10 text-sm text-cherry">{t("Delete client")}</Link>
        </div>
      </div>
      {saved && <p className="mt-3 rounded-lg bg-leaf-soft px-3 py-2 text-sm text-leaf">{t("Saved.")}</p>}
      {sync && <p className="mt-3 break-all rounded-lg bg-ground px-3 py-2 text-sm text-ink-soft">{t("Sync: {detail}", { detail: sync })}</p>}

      {/* Launch: everything has to be live before the owner gets their login + welcome page (lib/welcome.ts) */}
      <section id="launch" className="card mt-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold">{t("Launch")}</h2>
            <p className="mt-1 text-xs text-ink-mute">{t("When every item is green, Send welcome makes their login and private welcome page (video, login, their review pictures, links) and texts it to the owner's cell.")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
          <a href={`/welcome/preview/${b.id}`} target="_blank" rel="noreferrer" className="btn btn-ghost h-11 text-sm">{t("Preview welcome page")}</a>
          <form action={sendWelcomeAction}>
            <input type="hidden" name="id" value={b.id} />
            <button disabled={!ready} className={`btn h-11 text-sm ${ready ? "btn-ink" : "btn-ghost"}`} title={ready ? "" : t("Locked until every item is green")}>{w.welcome_sent_at ? t("Send welcome again") : t("Send welcome")}</button>
          </form>
          </div>
        </div>
        <ul className="mt-4 grid gap-1.5 text-sm md:grid-cols-2">
          {launch.map((c) => (
            <li key={c.key} className="flex items-start gap-2">
              <span className={`mt-0.5 inline-block h-4 w-4 flex-none rounded-full ${c.ok ? "bg-leaf" : "bg-cherry"}`} />
              <span><b>{t(c.label)}</b> <span className="text-ink-mute">· {c.detail}</span></span>
            </li>
          ))}
        </ul>
        {w.welcome_token && (
          <div className="mt-4 rounded-lg bg-ground px-3 py-2 text-sm">
            <div>{t("Welcome page")}: <a href={welcomeUrl(w.welcome_token)} target="_blank" rel="noreferrer" className="font-semibold underline break-all">{welcomeUrl(w.welcome_token)}</a></div>
            <div className="mt-1 text-ink-soft">
              {t("Sent {when}", { when: pacific(w.welcome_sent_at) || "-" })} · {w.welcome_opened_at ? t("Opened {when}", { when: pacific(w.welcome_opened_at) }) : t("Not opened yet")} · {w.welcome_password ? t("Temporary password {pw} (cleared at their first sign-in)", { pw: w.welcome_password }) : t("They have signed in")}
            </div>
          </div>
        )}
      </section>

      <form action={updateBusiness} className="mt-6 grid gap-6 md:grid-cols-2">
        <input type="hidden" name="id" value={b.id} />
        <section className="card p-6">
          <h2 className="font-extrabold">{t("Account")}</h2>
          <div className="mt-4 grid gap-3">
            <Field name="name" label={t("Business name")} value={b.name} />
            <Field name="owner_name" label={t("Owner")} value={b.owner_name} />
            <Field name="email" label={t("Login email")} value={b.email} type="email" />
            <Field name="new_password" label={t("New password")} value="" hint={t("Leave blank to keep")} />
            <Field name="owner_phone" label={t("Owner cell")} value={b.owner_phone} />
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Status")}</span>
              <select name="status" defaultValue={b.status} className="field mt-1">
                {["trial", "active", "paused", "cancelled"].map((s) => <option key={s} value={s}>{t(s)}</option>)}
              </select>
            </label>
            <Field name="plan_cents" label={t("Plan (cents / month)")} value={b.plan_cents} type="number" hint={t("What they pay us. 19900 = $199. For a white-label location, the wholesale price.")} />
            <Field name="fixed_cost_cents" label={t("Fixed cost (cents / month)")} value={b.fixed_cost_cents ?? 265} type="number" hint={t("Number + campaign fee. 265 = $2.65 on a low-volume line.")} />
            <Field name="setup_cost_cents" label={t("Setup cost (cents, one time)")} value={b.setup_cost_cents ?? 2000} type="number" hint={t("Brand + campaign registration. 2000 = $20.")} />
            <Field name="monthly_limit" label={t("Requests per month")} value={b.monthly_limit} type="number" hint={t("{n} sent so far this month. 0 = no limit.", { n: Number(usedThisMonth?.n ?? 0) })} />
            <Field name="review_link" label={t("Google review link")} value={b.review_link} />
            <Field name="timezone" label={t("Timezone")} value={b.timezone} />
          </div>
        </section>
        <section className="card p-6">
          <h2 className="font-extrabold">{t("Wiring")}</h2>
          <p className="mt-1 text-xs text-ink-mute">{t("Leave Twilio fields blank to send on the house line. Fill all three to send on this business’s own line.")}</p>
          <div className="mt-4 grid gap-3">
            <Field name="twilio_account_sid" label={t("Twilio account / subaccount SID")} value={b.twilio_account_sid} />
            <Field name="twilio_auth_token" label={t("Twilio auth token")} value="" type="password" hint={b.twilio_auth_token ? t("Set. Blank keeps it.") : t("Not set")} />
            <Field name="messaging_service_sid" label={t("Messaging Service SID")} value={b.messaging_service_sid} />
            <Field name="sms_number" label={t("Sending number (E.164)")} value={b.sms_number} hint={t("Used to route inbound replies")} />
            <Field name="gbp_account_id" label={t("GBP account id")} value={b.gbp_account_id} />
            <Field name="gbp_location_id" label={t("GBP location id")} value={b.gbp_location_id} />
            <Field name="gate_url" label={t("Review link on their domain")} value={b.gate_url} hint={t("e.g. https://theirsite.com/review — their site must rewrite /review/:code to {site}/r/:code. Blank = {site}", { site: BRAND.domain })} />
            <Field name="doc_url" label={t("Quote / invoice link on their domain")} value={b.doc_url} hint={t("e.g. https://theirsite.com/q — their site must rewrite /q/:token to {site}/d/:token. Blank = {site}", { site: BRAND.domain })} />
            <Field name="photo_geo" label={t("Photo geotag location")} value={b.photo_geo} hint={t("lat, lng of the home base, e.g. 33.8497, -117.7876. Photos without a phone location get this before they go to Google. Blank = no geotag")} />
            <Field name="website" label={t("Website")} value={b.website} hint={t("Their live site, e.g. https://theirsite.com. Checked daily; the leads form, review link and quotes point here.")} />
            <Field name="ads_url" label={t("Google Ads landing page")} value={b.ads_url} hint={t("e.g. https://quote.theirsite.com. Shown at the top of their welcome page. Blank = not shown")} />
            <Field name="site_repo" label={t("Website code (GitHub repo)")} value={b.site_repo} hint={t("Where the site lives. Anyone on the team clones it, runs Claude Code in it, pushes to main, and Vercel deploys. The repo's CLAUDE.md explains the rest.")} />
            <Field name="site_deploy_hook" label={t("Website deploy hook (Vercel)")} value={b.site_deploy_hook} hint={t("We POST it when a new review lands so the site rebuilds with the fresh reviews from /api/public/reviews/{slug}. {check}", { slug: b.slug, check: b.site_checked_at ? t("Site check {when}: {detail}", { when: b.site_checked_at, detail: b.site_detail }) : t("Site not checked yet.") })} />
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Review replies")}</span>
              <select name="auto_reply" defaultValue={String(b.auto_reply)} className="field mt-1">
                <option value="1">{t("Automatic: Claude writes and posts within the hour")}</option>
                <option value="0">{t("Manual: we post it ourselves from the Reviews tab")}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Link in the text")}</span>
              <select name="track_links" defaultValue={String(b.track_links ?? 0)} className="field mt-1">
                <option value="0">{t("Their Google review link, as is")}</option>
                <option value="1">{t("Tracked {site} link (records taps, then forwards to Google)", { site: BRAND.domain })}</option>
              </select>
            </label>
          </div>
          <div className="mt-4 rounded-lg bg-ground p-3 text-xs text-ink-soft">
            <div className="font-bold text-ink">{t("Inbound SMS URL for their Messaging Service")}</div>
            <code className="break-all">{baseUrl()}/api/sms/inbound?b={b.webhook_token}</code>
          </div>
        </section>
        <section id="features" className="card p-6 md:col-span-2">
          <h2 className="font-extrabold">{t("Features")}</h2>
          <p className="mt-1 text-xs text-ink-mute">{t("Reviews are always on. Everything here is off by default, and a client never sees a feature that is off.")}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Phone (business line, calls from the app)")}</span>
              <select name="feature_phone" defaultValue={String(b.feature_phone ?? 0)} className="field mt-1">
                <option value="0">{t("Off")}</option>
                <option value="1">{t("On")}</option>
              </select>
              <span className="mt-1 block text-xs text-ink-mute">{b.twiml_app_sid ? t("Wired ({sid}).", { sid: b.number_sid }) : t("Not wired yet. Save, then press Set up phone line below.")}</span>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Invoices (receipt, invoice or quote tool)")}</span>
              <select name="feature_invoices" defaultValue={String(b.feature_invoices ?? 0)} className="field mt-1">
                <option value="0">{t("Off")}</option>
                <option value="1">{t("On")}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Texts (customer inbox, new messages, ask for a review from a thread)")}</span>
              <select name="feature_messages" defaultValue={String(b.feature_messages ?? 0)} className="field mt-1">
                <option value="0">{t("Off")}</option>
                <option value="1">{t("On")}</option>
              </select>
              <span className="mt-1 block text-xs text-ink-mute">{t("Needs their own line. Press Point texting at {brand} below so incoming texts arrive.", { brand: NAME })}</span>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Photos (owner uploads, we drip them onto Google)")}</span>
              <select name="feature_photos" defaultValue={String(b.feature_photos ?? 0)} className="field mt-1">
                <option value="0">{t("Off")}</option>
                <option value="1">{t("On")}</option>
              </select>
              <span className="mt-1 block text-xs text-ink-mute">{t("{a} on Google, {b} waiting. Needs the GBP ids above.", { a: Number(photos?.posted ?? 0), b: Number(photos?.waiting ?? 0) })}</span>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Their person in the team chat")}</span>
              <select name="rep_key" defaultValue={b.rep_key ?? REPS[0].key} className="field mt-1">
                {REPS.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </label>
            <Field name="forward_to" label={t("Line rings this cell")} value={b.forward_to ?? ""} hint={t("One or more cells, comma separated. They all ring at once and whoever presses 1 first takes the call. Blank uses the owner cell. The owner can change it in the app.")} />
            <Field name="lead_alert_phones" label={t("Lead alerts text these cells")} value={b.lead_alert_phones ?? ""} hint={t("Comma separated. Every new web or ad lead texts each of these from the business line. Blank uses the owner cell.")} />
            <Field name="ring_seconds" label={t("Ring for (seconds)")} value={b.ring_seconds ?? 20} type="number" hint={t("10 to 45, then it counts as missed and the caller gets the text back.")} />
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Caller ID on their cell")}</span>
              <select name="ring_as_line" defaultValue={String(b.ring_as_line ?? 0)} className="field mt-1">
                <option value="0">{t("The customer's number")}</option>
                <option value="1">{t("The business line")}</option>
              </select>
              <span className="mt-1 block text-xs text-ink-mute">{t("Business line gets past Silence Unknown Callers once the line is saved as a contact. The announcement still says who is calling.")}</span>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-ink-soft">{t("Line language")}</span>
              <select name="line_language" defaultValue={b.line_language ?? "en"} className="field mt-1">
                <option value="en">{t("English")}</option>
                <option value="es">{t("Spanish")}</option>
              </select>
              <span className="mt-1 block text-xs text-ink-mute">{t("The “call for your business, press 1” announcement and the default missed-call text.")}</span>
            </label>
            <Field name="missed_call_text" label={t("Missed-call text")} value={b.missed_call_text ?? ""} hint={t("Blank uses the default in the line language.")} />
          </div>
        </section>
        <div className="md:col-span-2">
          <button className="btn btn-sun">{t("Save changes")}</button>
        </div>
      </form>
      <form action={setupPhoneLine} className="mt-3">
        <input type="hidden" name="id" value={b.id} />
        <button className="btn btn-ghost h-10 text-sm">{b.twiml_app_sid ? t("Re-run phone line setup") : t("Set up phone line")}</button>
        <span className="ml-3 text-xs text-ink-mute">{t("Points {num}’s incoming calls at {brand} and turns on calling from the app. Texting is not touched.", { brand: NAME, num: b.sms_number ? prettyPhone(b.sms_number) : t("the number") })}</span>
      </form>
      <form action={setupTexting} className="mt-2">
        <input type="hidden" name="id" value={b.id} />
        <button className="btn btn-ghost h-10 text-sm">{t("Point texting at {brand}", { brand: NAME })}</button>
        <span className="ml-3 text-xs text-ink-mute">{t("Sends this line’s incoming texts to the app inbox and turns Texts on. The old address is saved on the timeline.")}</span>
      </form>
      <form action={saveLogo} className="mt-2 flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={b.id} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {b.logo_url && <img src={b.logo_url} alt="" className="h-10 w-10 rounded object-contain" />}
        <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="text-xs" />
        <button className="btn btn-ghost h-10 text-sm">{b.logo_url ? t("Replace invoice logo") : t("Add invoice logo")}</button>
        <span className="text-xs text-ink-mute">{t("Shows on their receipts, invoices and quotes, and sets their colors. Save with no file picked to remove it.")}</span>
      </form>
      <form action={saveBrandColors} className="mt-2 flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={b.id} />
        <label className="flex items-center gap-2 text-xs font-bold text-ink-soft">{t("Header color")} <input type="color" name="brand_color" defaultValue={resolveBrand(b).main} className="h-10 w-12 cursor-pointer rounded border border-line-strong bg-canvas p-1" /></label>
        <label className="flex items-center gap-2 text-xs font-bold text-ink-soft">{t("Accent color")} <input type="color" name="brand_accent" defaultValue={resolveBrand(b).accent} className="h-10 w-12 cursor-pointer rounded border border-line-strong bg-canvas p-1" /></label>
        <button className="btn btn-ghost h-10 text-sm">{t("Save invoice colors")}</button>
        <span className="text-xs text-ink-mute">{t("Picked from the logo. Change them here only if they look off.")}</span>
      </form>

      <section id="chat" className="card mt-8 p-6">
        <h2 className="font-extrabold">{t("Team chat")} <Link href={`/admin/chat?business=${b.id}`} className="ml-2 text-xs font-bold text-ink-soft hover:text-ink">{t("Open in Client chat →")}</Link></h2>
        <p className="mt-1 text-xs text-ink-mute">{t("What {owner} sees behind the chat button. Your reply shows as {rep} and pushes to their phone.", { owner: b.owner_name || t("the owner"), rep: REPS.find((r) => r.key === (b.rep_key ?? REPS[0].key))?.name ?? REPS[0].name })}</p>
        <div className="mt-4 max-h-96 space-y-2 overflow-y-auto rounded-lg bg-ground p-3">
          {chat.length === 0 && <p className="text-sm text-ink-mute">{t("No messages yet.")}</p>}
          {chat.map((m, i) => (
            <div key={i} className={`flex ${m.sender === "team" ? "justify-end" : ""}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.sender === "team" ? "bg-ink text-white" : "border border-line bg-white"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.image_url && <img src={m.image_url} alt="" className="mb-1 max-h-48 rounded-lg" />}
                {m.body}
                <div className={`mt-0.5 text-[10px] ${m.sender === "team" ? "text-white/50" : "text-ink-mute"}`}>{m.created_at}</div>
              </div>
            </div>
          ))}
        </div>
        <form action={replyTeamChat} className="mt-3 flex gap-2">
          <input type="hidden" name="id" value={b.id} />
          <input name="body" className="field flex-1" placeholder={t("Reply as their account manager")} autoComplete="off" />
          <button className="btn btn-sun">{t("Send")}</button>
        </form>
      </section>
      <form action={clearBusinessData} className="mt-3">
        <input type="hidden" name="id" value={b.id} />
        <button className="text-xs font-bold text-cherry hover:underline">{t("Wipe all customers, requests, reviews and texts for this business (keeps the login)")}</button>
      </form>


      <PosterSetup businessId={b.id} sign={b.poster_template ?? ""} meme={b.meme_template ?? ""} testPhone={b.owner_phone ?? ""} sent={sentPhotos} />

      <section id="sequence" className="card mt-8 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-extrabold">{t("Message sequence")}</h2>
          <span className="text-xs text-ink-mute">{t.n(Number(active?.n ?? 0), "{n} customer mid-sequence right now", "{n} customers mid-sequence right now")}</span>
        </div>
        <p className="mt-1 text-xs text-ink-mute">
          {t("Step 1 waits its delay after the customer is added; each later step waits its delay after the previous text. The sequence stops on its own when the review shows up on Google or the customer texts STOP. Placeholders: {name}, {business}, {link}.")}
        </p>
        <form action={saveSequence} className="mt-4 grid gap-4">
          <input type="hidden" name="id" value={b.id} />
          {[...steps, { id: 0, business_id: b.id, position: steps.length + 1, delay_minutes: 0, body: "", poster_template: "" }].map((st, i) => {
            const isNew = st.id === 0;
            const d = st.delay_minutes;
            const unit = d >= 1440 && d % 1440 === 0 ? "days" : d >= 60 && d % 60 === 0 ? "hours" : "minutes";
            const n = unit === "days" ? d / 1440 : unit === "hours" ? d / 60 : d;
            return (
              <div key={st.id || "new"} className={`rounded-xl border p-3 ${isNew ? "border-dashed border-line-strong" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">{isNew ? t("Add a step") : t("Step {n}", { n: i + 1 })}</span>
                  <span className="text-ink-mute">{t("sends")}</span>
                  <input name="delay" type="number" min={0} defaultValue={isNew ? "" : n} className="field h-9 w-20" placeholder="3" />
                  <select name="unit" defaultValue={isNew ? "days" : unit} className="field h-9 w-auto">
                    <option value="minutes">{t("minutes")}</option>
                    <option value="hours">{t("hours")}</option>
                    <option value="days">{t("days")}</option>
                  </select>
                  <span className="text-ink-mute">{i === 0 ? t("after the customer is added") : t("after the previous text")}</span>
                </div>
                <textarea name="body" rows={2} defaultValue={st.body} className="field mt-2" placeholder={isNew ? t("Leave empty to add nothing") : ""} />
                <label className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
                  {t("Picture")}
                  <select name="poster" defaultValue={st.poster_template ?? ""} className="field h-9 w-auto">
                    <option value="">{i === 0 ? t("Their sign photo (default)") : i === 1 ? t("Their meme photo (default)") : t("None, words only")}</option>
                    {Object.keys(TEMPLATES).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
              </div>
            );
          })}
          <div>
            <button className="btn btn-sun">{t("Save sequence")}</button>
            <span className="ml-3 text-xs text-ink-mute">{t("Empty a step’s text to remove it.")}</span>
          </div>
        </form>
      </section>

      <section className="card mt-8 p-6">
        <h2 className="font-extrabold">{t("Texts we sent on their behalf")}</h2>
        <p className="mt-1 text-xs text-ink-mute">{t("Internal only. The business never sees this log.")}</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {messages.map((m, i) => (
            <li key={i} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                <span className={`h-2 w-2 rounded-full ${m.ok ? "bg-leaf" : "bg-cherry"}`} />
                <span>{m.created_at}</span>
                <span className="font-bold text-ink">{m.lane === "owner" ? t("to owner") : t("to customer")} {m.to_phone}</span>
                <span>{m.detail}</span>
              </div>
              <p className="mt-1 text-ink">{m.body}</p>
            </li>
          ))}
          {!messages.length && <li className="py-2 text-ink-mute">{t("Nothing sent yet.")}</li>}
        </ul>
      </section>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-extrabold">{t("Connections")}</h2>
          <p className="mt-1 text-xs text-ink-mute">{t("We wire these into their POS, CRM or booking tool. Paste the URL into the provider’s webhook settings.")}</p>
          <ul className="mt-3 text-sm">
            {integrations.map((i) => (
              <li key={i.id} className="border-t border-line py-3 first:border-t-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{t(PROVIDER_LABELS[i.provider as keyof typeof PROVIDER_LABELS] ?? i.provider)}</span>
                  <span className="text-xs text-ink-mute">{t.n(i.events, "{n} event", "{n} events")}{i.last_event_at ? t(", last {when}", { when: i.last_event_at }) : ""}{i.signing_secret ? t(", signed") : ""}</span>
                </div>
                <code className="mt-1 block break-all rounded-lg bg-ground px-2 py-1.5 text-xs">{baseUrl()}/api/hooks/{i.provider}/{i.token}</code>
                <p className="mt-1 text-xs text-ink-mute">{PROVIDER_HELP[i.provider as keyof typeof PROVIDER_HELP]}</p>
                <form action={deleteIntegration} className="mt-1">
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="integration_id" value={i.id} />
                  <button className="text-xs font-bold text-cherry hover:underline">{t("Remove")}</button>
                </form>
              </li>
            ))}
            {!integrations.length && <li className="text-ink-mute">{t("None yet.")}</li>}
          </ul>
          <form action={createIntegration} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={b.id} />
            <select name="provider" className="field w-auto">
              {PROVIDERS.map((p) => <option key={p} value={p}>{t(PROVIDER_LABELS[p])}</option>)}
            </select>
            <input name="signing_secret" placeholder={t("Signing secret (Stripe / Square, optional)")} className="field flex-1" />
            <button className="btn btn-ghost h-11 text-sm">{t("Add connection")}</button>
          </form>
        </section>
        <section id="dnc" className="card p-6">
          <h2 className="font-extrabold">{t("Do not contact ({n})", { n: blocked.length })}</h2>
          <p className="mt-1 text-xs text-ink-mute">{t("Keyed by phone. Checked when a customer arrives from any source and again right before every text. Adding a number stops whatever is scheduled for it.")}</p>
          <ul className="mt-3 text-sm">
            {blocked.map((x) => (
              <li key={x.phone} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="min-w-0">
                  <span className="font-bold">{x.name || prettyPhone(x.phone)}</span>{" "}
                  <span className="text-ink-soft">{x.name ? prettyPhone(x.phone) : ""}</span>
                  <span className="block text-xs text-ink-mute">{t("{when}, by {who}", { when: x.created_at, who: x.added_by })}{x.reason ? `: ${x.reason}` : ""}</span>
                </span>
                <form action={unblockContact}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="phone" value={x.phone} />
                  <button className="text-xs font-bold text-cherry hover:underline">{t("Allow again")}</button>
                </form>
              </li>
            ))}
            {!blocked.length && <li className="text-ink-mute">{t("Nobody yet.")}</li>}
          </ul>
          <form action={blockContact} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={b.id} />
            <input name="phone" placeholder={t("Phone")} className="field w-40" required />
            <input name="name" placeholder={t("Name (optional)")} className="field w-40" />
            <input name="reason" placeholder={t("Reason (optional, only we see it)")} className="field flex-1" />
            <button className="btn btn-ghost h-11 text-sm">{t("Block")}</button>
          </form>
          <h3 className="mt-6 text-sm font-extrabold">{t("In the buffer right now ({n})", { n: scheduled.length })}</h3>
          <ul className="mt-2 text-sm">
            {scheduled.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span><span className="font-bold">{r.name || prettyPhone(r.phone)}</span> <span className="text-ink-mute">{t("step {n} at {when} UTC", { n: r.step + 1, when: r.next_at })}</span></span>
                <form action={blockContact}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="phone" value={r.phone} />
                  <button className="text-xs font-bold text-cherry hover:underline">{t("Block")}</button>
                </form>
              </li>
            ))}
            {!scheduled.length && <li className="text-ink-mute">{t("Nothing scheduled.")}</li>}
          </ul>
        </section>
        <section className="card p-6">
          <h2 className="font-extrabold">{t("Recent activity")}</h2>
          <ul className="mt-3 text-sm">
            {events.map((e, i) => (
              <li key={i} className="border-t border-line py-2 first:border-t-0">
                <span className="text-ink-mute">{e.created_at}</span> <span className="font-bold">{e.kind}</span> <span className="text-ink-soft">{e.detail}</span>
              </li>
            ))}
            {!events.length && <li className="text-ink-mute">{t("Nothing yet.")}</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
