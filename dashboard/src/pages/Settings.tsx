import { useEffect, useState, type ReactNode } from "react";
import { api, patch, post, del } from "../lib/api";
import { clearToken } from "../lib/auth";
import { unregisterPush } from "../lib/push";
import { navigate } from "../lib/router";
import { Sheet } from "../ui/Sheet";
import { Masthead } from "../ui/bits";
import { Icon } from "../ui/icons";
import { useToast } from "../ui/Toast";
import { prettyPhone, prettyPhoneList } from "../lib/format";
import { tap, success, isNative } from "../lib/native";
import { LineSettings, type Line } from "./Phone";
import { NAME, SITE } from "../brand";

type Features = { phone: boolean; messages: boolean; invoices: boolean; photos: boolean };
export type Biz = {
  id: number; name: string; owner_name: string; email: string; owner_phone: string; review_link: string; message_template: string; delay_minutes: number;
  owner_alerts: number; status: string; trial_ends_at: string; has_own_line: boolean; gbp_linked: boolean;
  notify_texts?: number; notify_calls?: number; notify_reviews?: number; notify_photos?: number;
  features?: Features;
  rep?: { key: string; name: string; title: string; photo: string };
};

type Item = { key: string; icon: keyof typeof Icon; title: string; line: string; detail: string };

// What every business gets, then what can be switched on. One list drives both halves of the plan card:
// an item the business has shows as included, the rest show as services they can ask the rep about.
const CORE: Item[] = [
  { key: "requests", icon: "send", title: "Review requests by text", line: "Every customer gets asked, on its own", detail: "" },
  { key: "followups", icon: "sparkle", title: "Automatic follow-ups", line: "A friendly nudge if they forget", detail: "" },
  { key: "replies", icon: "star", title: "Replies to every Google review", line: "Written and posted for you", detail: "" },
];
const OPTIONAL: (Item & { feature?: keyof Features })[] = [
  { key: "phone", feature: "phone", icon: "phone", title: "Business phone line", line: "Call customers without showing your cell", detail: "A business number that rings your cell. You hear who is calling before you pick up, a missed caller gets a text back right away, and you call customers from the app so they never see your personal number." },
  { key: "messages", feature: "messages", icon: "chat", title: "Customer texting", line: "Every conversation in one inbox", detail: "Text customers from your business number. Photos, quotes and questions all land in one inbox, and you can ask a happy customer for a review with one tap." },
  { key: "invoices", feature: "invoices", icon: "doc", title: "Invoices and quotes", line: "Say the job, send the invoice", detail: "Say what the job was and get a clean receipt, invoice or quote with your logo on it. Text it to the customer in seconds, right from the job site." },
  { key: "photos", feature: "photos", icon: "image", title: "Photos on your Google profile", line: "We post your job photos for you", detail: "Send us photos from your phone. We post them to your Google profile one at a time so it always looks active, which helps you show up when people search." },
  { key: "chatbot", icon: "bot", title: "AI chatbot", line: "Answers customers and books estimates for you", detail: "New customers get an answer right away, even at 10pm or while you are on a roof. It answers their questions, collects the job details and books the estimate straight onto your calendar, so you stop losing jobs to whoever replies first." },
  { key: "lsa", icon: "shield", title: "Google Local Services Ads", line: "The top of Google, with the Guaranteed badge", detail: "Show up above everything else on Google with the Google Guaranteed badge. You pay for customers who actually contact you, not for clicks. We set it up and run it." },
];

export function Settings({ business, onSaved, onSignOut }: { business: Biz; onSaved: (b: Biz) => void; onSignOut: () => void }) {
  const toast = useToast();
  const rep = business.rep?.name ?? "us";
  const [line, setLine] = useState<Line | null>(null);
  const [lineOpen, setLineOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const [refer, setRefer] = useState(false);
  const [ask, setAsk] = useState<Item | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (business.features?.phone) api<{ line: Line }>("/api/v1/phone").then((r) => setLine(r.line)).catch(() => {});
  }, [business.features?.phone]);

  const has = (i: (typeof OPTIONAL)[number]) => Boolean(i.feature && business.features?.[i.feature]);
  const included = [...CORE, ...OPTIONAL.filter(has)];
  const addons = OPTIONAL.filter((i) => !has(i));

  async function flip(key: "notify_texts" | "notify_calls" | "notify_reviews" | "notify_photos" | "owner_alerts", on: boolean) {
    onSaved({ ...business, [key]: on ? 1 : 0 });
    try {
      const r = await patch<{ business: Biz }>("/api/v1/settings", { [key]: on });
      onSaved(r.business);
    } catch (e) {
      onSaved(business);
      toast(e instanceof Error ? e.message : "Couldn't save");
    }
  }

  // "Ask about this" says it for them in the chat, then opens the chat so the conversation is already going.
  async function interested(item: Item) {
    setAsking(true);
    try {
      await post("/api/v1/team", { body: `I'm interested in adding ${item.title}. Can you tell me more?` });
      success();
      setAsk(null);
      navigate("/team");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <Masthead />
      <h1 className="h-page mt-5 md:mt-3">Settings</h1>

      {/* ---- Your plan ---- */}
      <section className="plan-card mt-6">
        <div className="plan-sheen" aria-hidden="true" />
        <p className="text-[13px] font-semibold uppercase tracking-wider text-white/50">What we do for you</p>
        <h2 className="mt-1 text-[24px] font-extrabold leading-tight tracking-tight">{business.name}</h2>
        <ul className="mt-5 space-y-3.5">
          {included.map((i, n) => (
            <li key={i.key} className="plan-item" style={{ animationDelay: `${120 + n * 70}ms` }}>
              <span className="plan-check"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" style={{ animationDelay: `${260 + n * 70}ms` }} /></svg></span>
              <span className="min-w-0">
                <span className="block text-[15.5px] font-semibold leading-snug">{i.title}</span>
                <span className="block text-[13px] leading-snug text-white/55">{i.line}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {addons.length > 0 && (
        <>
          <h2 className="h-section mt-8">Other things we can set up</h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {addons.map((i, n) => {
              const I = Icon[i.icon];
              return (
                <button key={i.key} type="button" onClick={() => { tap(); setAsk(i); }} className="addon" style={{ animationDelay: `${n * 60}ms` }}>
                  <span className="addon-icon"><I width={21} height={21} /></span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-[15.5px] font-bold leading-snug">{i.title}</span>
                    <span className="block text-[13px] leading-snug text-ink-mute">{i.line}</span>
                  </span>
                  <span className="addon-plus"><Icon.plus width={16} height={16} strokeWidth={2.8} /></span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[13px] text-ink-mute">Our team sets these up and runs them for you. Tap one to ask {rep} about it. Nothing is bought or unlocked in the app.</p>
        </>
      )}

      {/* ---- Refer a friend ---- */}
      <button type="button" onClick={() => { tap(); setRefer(true); }} className="refer-card mt-8">
        <span className="refer-gift" aria-hidden="true"><Icon.gift width={30} height={30} strokeWidth={1.9} /></span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[19px] font-extrabold leading-tight tracking-tight">Refer a friend</span>
          <span className="mt-1 block text-[14px] leading-snug">Know another business owner? Send them our way and we take care of you both.</span>
        </span>
        <Icon.chevron width={20} height={20} strokeWidth={2.4} />
      </button>

      {/* ---- Notifications ---- */}
      <h2 className="h-section mt-8">Notifications</h2>
      <section className="group">
        {business.features?.messages && <Switch label="New texts" hint="When a customer texts your business line" on={business.notify_texts !== 0} onChange={(v) => flip("notify_texts", v)} />}
        {business.features?.phone && <Switch label="Missed calls" hint="With one tap to call them back" on={business.notify_calls !== 0} onChange={(v) => flip("notify_calls", v)} />}
        <Switch label="New reviews" hint="Every time someone reviews you on Google" on={business.notify_reviews !== 0} onChange={(v) => flip("notify_reviews", v)} />
        {business.features?.photos && <Switch label="Photo reminders" hint="A nudge to send job photos when your Google profile runs out" on={business.notify_photos !== 0} onChange={(v) => flip("notify_photos", v)} />}
        <Switch label="Text my cell too" hint={business.owner_phone ? `Customer replies also go to ${prettyPhone(business.owner_phone)}` : "Add your cell under Account first"} on={!!business.owner_alerts} onChange={(v) => flip("owner_alerts", v)} />
      </section>
      <p className="mt-2 px-1 text-[13px] text-ink-mute">Messages from {rep} always come through.</p>

      {/* ---- Business line ---- */}
      {line && (
        <>
          <h2 className="h-section mt-8">Your business line</h2>
          <section className="group">
            <button type="button" onClick={() => { tap(); setLineOpen(true); }} className="row">
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-[15px] font-semibold">{prettyPhone(line.phone_number)}</span>
                <span className="block truncate text-[13px] text-ink-mute">Rings {prettyPhoneList(line.forward_to)} for {line.ring_seconds} seconds</span>
              </span>
              <Icon.chevron className="text-ink-mute" width={18} height={18} />
            </button>
          </section>
          <LineSettings open={lineOpen} line={line} onClose={() => setLineOpen(false)} onSaved={setLine} />
        </>
      )}

      {/* ---- Account ---- */}
      <h2 className="h-section mt-8">Account</h2>
      <section className="group">
        <button type="button" onClick={() => { tap(); setAccount(true); }} className="row">
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[15px] font-semibold">{business.owner_name || business.name}</span>
            <span className="block truncate text-[13px] text-ink-mute">{business.email}</span>
          </span>
          <Icon.chevron className="text-ink-mute" width={18} height={18} />
        </button>
        <button type="button" onClick={() => { tap(); onSignOut(); }} className="row"><span className="flex-1 text-left text-[15px] font-semibold">Sign out</span></button>
      </section>
      <p className="mt-5 text-center text-[12px] text-ink-mute">
        <a href={isNative ? `${SITE}/privacy` : "/privacy"} target="_blank" rel="noreferrer" className="underline">Privacy</a> · <a href={isNative ? `${SITE}/support` : "/support"} target="_blank" rel="noreferrer" className="underline">Support</a>
      </p>

      <Sheet open={!!ask} onClose={() => setAsk(null)} title={ask?.title}>
        {ask && (
          <>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{ask.detail}</p>
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={() => interested(ask)} disabled={asking} className="btn btn-sun h-12">{asking ? "Sending…" : `Ask ${rep} about this`}</button>
              <button type="button" onClick={() => setAsk(null)} className="btn btn-ghost h-12">Not now</button>
            </div>
          </>
        )}
      </Sheet>

      <ReferSheet open={refer} onClose={() => setRefer(false)} business={business} />
      <AccountSheet open={account} onClose={() => setAccount(false)} business={business} onSaved={onSaved} />
    </>
  );
}

function Switch({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => { tap(); onChange(!on); }} className="row">
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-semibold">{label}</span>
        <span className="block text-[13px] leading-snug text-ink-mute">{hint}</span>
      </span>
      <span className={`ios-switch ${on ? "on" : ""}`} />
    </button>
  );
}

function ReferSheet({ open, onClose, business }: { open: boolean; onClose: () => void; business: Biz }) {
  const [f, setF] = useState({ name: "", business: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (open) { setDone(false); setErr(""); setF({ name: "", business: "", phone: "" }); }
  }, [open]);
  const share = `I use ${NAME} to get more Google reviews for ${business.name}. Tell them ${business.name} sent you: ${SITE}`;

  async function send() {
    setBusy(true);
    setErr("");
    try {
      await post("/api/v1/referrals", f);
      success();
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={done ? "Thank you" : "Refer a friend"}>
      {done ? (
        <>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">We will reach out to {f.name.split(" ")[0] || "them"} and mention you sent us. We take care of you both.</p>
          <button type="button" onClick={onClose} className="btn btn-ink mt-4 h-12 w-full">Done</button>
        </>
      ) : (
        <>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">Tell us who, and we take it from there. We reach out, mention you sent us, and take care of you both.</p>
          <label className="label mt-4">Their name</label>
          <input className="field" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} autoComplete="off" />
          <label className="label mt-3">Their business</label>
          <input className="field" value={f.business} onChange={(e) => setF((x) => ({ ...x, business: e.target.value }))} autoComplete="off" />
          <label className="label mt-3">Their cell</label>
          <input className="field" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))} placeholder="(714) 555-1234" />
          {err && <p className="mt-2 text-[13px] font-semibold text-cherry">{err}</p>}
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={send} disabled={busy || !f.name.trim() || f.phone.replace(/\D/g, "").length < 10} className="btn btn-sun h-12">{busy ? "Sending…" : "Send referral"}</button>
            {typeof navigator.share === "function" ? (
              <button type="button" onClick={() => navigator.share({ text: share }).catch(() => {})} className="btn btn-ghost h-12">Or text them yourself</button>
            ) : (
              <a href={`sms:?&body=${encodeURIComponent(share)}`} className="btn btn-ghost h-12">Or text them yourself</a>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

function AccountSheet({ open, onClose, business, onSaved }: { open: boolean; onClose: () => void; business: Biz; onSaved: (b: Biz) => void }) {
  const [f, setF] = useState({ name: business.name, owner_name: business.owner_name, owner_phone: business.owner_phone });
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delPw, setDelPw] = useState("");
  const toast = useToast();
  useEffect(() => {
    if (open) { setF({ name: business.name, owner_name: business.owner_name, owner_phone: business.owner_phone }); setPw(""); setErr(""); setDeleting(false); setDelPw(""); }
  }, [open, business]);

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const r = await patch<{ business: Biz }>("/api/v1/settings", { ...f, ...(pw ? { password: pw } : {}) });
      onSaved(r.business);
      success();
      toast("Saved");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }
  async function deleteAccount() {
    setBusy(true);
    setErr("");
    try {
      await del("/api/v1/account", { password: delPw });
      await unregisterPush();
      await clearToken();
      window.dispatchEvent(new Event("hm:signout"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't delete the account");
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, node: ReactNode) => (<><label className="label mt-3">{label}</label>{node}</>);

  return (
    <Sheet open={open} onClose={onClose} title={deleting ? "Delete my account" : "Account"}>
      {deleting ? (
        <>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">This permanently deletes {business.name}: every customer, text, call, invoice, photo and review copy. Scheduled texts stop. It cannot be undone.</p>
          {field("Your password", <input className="field" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />)}
          {err && <p className="mt-2 text-[13px] font-semibold text-cherry">{err}</p>}
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={deleteAccount} disabled={busy || !delPw} className="btn h-12 bg-cherry text-white">Delete everything</button>
            <button type="button" onClick={() => setDeleting(false)} className="btn btn-ghost h-12">Keep my account</button>
          </div>
        </>
      ) : (
        <>
          {field("Business name", <input className="field" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />)}
          {field("Your name", <input className="field" value={f.owner_name} onChange={(e) => setF((x) => ({ ...x, owner_name: e.target.value }))} />)}
          {field("Your cell", <input className="field" type="tel" inputMode="tel" value={f.owner_phone} onChange={(e) => setF((x) => ({ ...x, owner_phone: e.target.value }))} />)}
          {field("New password", <input className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Leave blank to keep" />)}
          {err && <p className="mt-2 text-[13px] font-semibold text-cherry">{err}</p>}
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={save} disabled={busy} className="btn btn-ink h-12">Save</button>
            <button type="button" onClick={onClose} className="btn btn-ghost h-12">Cancel</button>
          </div>
          <button type="button" onClick={() => { tap(); setDeleting(true); setErr(""); }} className="mt-5 w-full text-center text-[13px] font-semibold text-cherry">Delete my account</button>
        </>
      )}
    </Sheet>
  );
}
