import Image from "next/image";
import { BRAND, MARK as MASCOT, NAME } from "@/lib/whitelabel";
import type { WelcomeBusiness } from "@/lib/welcome";
import { repFor } from "@/lib/reps";
import { prettyPhone } from "@/lib/phone";
import { firstName } from "@/lib/template";
import { CopyField, WelcomeVideo } from "./[token]/Video";

// One design for every client's welcome page (lib/welcome.ts). Used by the real page (/welcome/<token>)
// and by the ops-only preview (/welcome/preview/<id>).
const APP_STORE = "https://apps.apple.com/us/app/happy-mouths/id6812206708";

/** The page itself. `pics` = picture URLs (null where that picture isn't set up yet); `preview` adds an ops banner. */
import { REACTIVATION_PER_DAY } from "@/lib/reactivation";
export function WelcomeView({ b, password, pics, preview }: { b: WelcomeBusiness; password: string; pics: { sign: string | null; meme: string | null }; preview?: boolean }) {
  const first = firstName(b.owner_name) || "there";
  const rep = repFor(b.rep_key);
  const site = b.website ? b.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : "";
  const line = b.sms_number ? prettyPhone(b.sms_number) : "";

  return (
    <main className="fun min-h-dvh overflow-x-hidden">
      {preview && <div className="bg-ink px-5 py-2 text-center text-[14px] font-bold text-sun">Preview for ops: nothing was sent. The password shown is an example; the real one is made when you press Send welcome.</div>}
      <header className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 pt-5">
        <span className="flex items-center gap-2">
          <Image src={MASCOT} alt="" width={44} height={44} priority />
          <span className="display text-2xl">{NAME}</span>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {b.logo_url && <img src={b.logo_url} alt="" className="h-12 w-12 rounded-xl border border-line object-contain bg-white" />}
      </header>

      <section className="mx-auto max-w-4xl px-5 pb-16 pt-8 md:pt-12">
        <p className="inline-block rounded-full border border-line bg-white px-3 py-0.5 text-[12px] font-extrabold uppercase tracking-wide">{b.name}</p>
        <h1 className="mt-4 text-[2.2rem] leading-[1.05] sm:text-[2.8rem]">Welcome, {first}. You&rsquo;re live.</h1>
        <p className="mt-4 max-w-[38rem] text-[17px] leading-relaxed">Your review texts, your Google profile and your website are all set up. Here&rsquo;s your login, the app, and a 4-minute video on how everything works.</p>
        {b.ads_url && (
          <a href={b.ads_url} target="_blank" rel="noreferrer" className="sticker mt-5 block max-w-[38rem] p-4 hover:bg-sun">
            <span className="block text-[12px] font-extrabold uppercase tracking-wide text-ink-soft">Your Google Ads landing page</span>
            <span className="mt-1 block truncate text-[1.05rem] font-extrabold underline">{b.ads_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
            <span className="mt-1 block text-[14px] text-ink-soft">Where people land when they click your Google ad. Quote requests from it text you right away.</span>
          </a>
        )}

        {/* 1. login + app */}
        <div className="sticker mt-8 p-5 md:p-7">
          <h2 className="text-[1.3rem] leading-snug md:text-[1.6rem]">Sign in to the app</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <CopyField label="Email" value={b.email} />
            {password ? <CopyField label="Password" value={password} /> : (
              <div className="rounded-xl border border-line bg-ground px-4 py-3 text-[15px] leading-snug text-ink-soft">You&rsquo;ve already signed in, so your password is no longer shown here. Forgot it? Message {rep.name}.</div>
            )}
          </div>
          {password && <p className="mt-3 text-[15px] text-ink-soft">Change the password any time in the app under Settings. Your team can use this same login.</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            <a href={APP_STORE} target="_blank" rel="noreferrer" className="btn-fun">Get the iPhone app</a>
            <a href="/app/login" target="_blank" rel="noreferrer" className="inline-flex h-14 items-center rounded-full border border-line-strong bg-white px-6 text-[16px] font-extrabold">Open it on the web</a>
          </div>
        </div>

        {/* 2. video (brand.json "welcomeVideo"; the card hides when it is blank) */}
        {BRAND.welcomeVideo && <div className="sticker mt-5 p-5 md:p-7">
          <h2 className="text-[1.3rem] leading-snug md:text-[1.6rem]">Watch how it all works</h2>
          <p className="mt-2 text-[16px] leading-relaxed text-ink-soft">How Google ranks you, then a walk through the app.</p>
          <div className="mt-4"><WelcomeVideo src={BRAND.welcomeVideo} /></div>
        </div>}

        {/* 3. their pictures */}
        <div className="sticker mt-5 p-5 md:p-7">
          <h2 className="text-[1.3rem] leading-snug md:text-[1.6rem]">What your customers get</h2>
          <p className="mt-2 max-w-[40rem] text-[16px] leading-relaxed">After a job, each customer gets a review text with <b>your photo and their first name on it</b>. If they haven&rsquo;t left a review, a follow-up goes out a few days later. Here&rsquo;s yours, for a customer named Maria:</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([[pics.sign, "Text 1, after the job", "Their sign photo with the customer's first name goes here once it's set up in Pictures."], [pics.meme, "Follow-up, if no review yet", "The follow-up meme goes here once it's set up in Pictures."]] as const).map(([src, cap, missing]) => (
              <figure key={cap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src ? <img src={src} alt="" className="w-full rounded-xl border border-line-strong" /> : <div className="flex aspect-[4/5] items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-ground p-6 text-center text-[15px] font-extrabold text-ink-soft">{missing}</div>}
                <figcaption className="mt-2 text-[15px] font-extrabold">{cap}</figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-4 text-[15px] text-ink-soft">The texts stop the moment they leave a review, and we reply to every review for you.</p>
          <p className="mt-3 max-w-[40rem] text-[16px] leading-relaxed"><b>Your review list goes out {REACTIVATION_PER_DAY} people a day</b>, between 10am and 4pm, not all at once. New reviews then show up on Google a few at a time, which looks natural, and it&rsquo;s easy to keep up with anyone who texts back. Customers you add after a job are not part of the daily limit.</p>
        </div>

        {/* 4. links */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {site && (
            <a href={b.website} target="_blank" rel="noreferrer" className="sticker block p-4 hover:bg-sun">
              <span className="block text-[12px] font-extrabold uppercase tracking-wide text-ink-soft">Your website</span>
              <span className="mt-1 block truncate text-[1.05rem] font-extrabold underline">{site}</span>
            </a>
          )}
          {b.review_link && (
            <a href={b.review_link} target="_blank" rel="noreferrer" className="sticker block p-4 hover:bg-sun">
              <span className="block text-[12px] font-extrabold uppercase tracking-wide text-ink-soft">Your Google review link</span>
              <span className="mt-1 block text-[1.05rem] font-extrabold underline">Open it</span>
            </a>
          )}
          {line && (
            <div className="sticker p-4">
              <span className="block text-[12px] font-extrabold uppercase tracking-wide text-ink-soft">Your business line</span>
              <span className="mt-1 block text-[1.05rem] font-extrabold">{line}</span>
            </div>
          )}
        </div>

        {/* 5. referral + questions */}
        <div className="sticker sticker-sun mt-5 p-5 md:p-7">
          <h2 className="text-[1.3rem] md:text-[1.6rem]">Refer a business owner, get a free month</h2>
          <p className="mt-2 text-[16px] leading-relaxed">Every client you send us is a free month for you. In the app: Settings, then Refer a friend.</p>
        </div>
        <div className="sticker sticker-cherry mt-5 p-6 md:p-8">
          <h2 className="text-[1.5rem] md:text-[1.9rem]">Questions?</h2>
          <p className="mt-2 text-[17px] leading-relaxed text-white/85">Tap &ldquo;Message {rep.name}&rdquo; at the top of the app. Changes, problems, or a feature you want: {rep.name} reads every message.</p>
        </div>
      </section>
    </main>
  );
}
