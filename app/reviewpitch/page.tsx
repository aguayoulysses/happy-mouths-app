import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";
import { MARK as MASCOT, NAME } from "@/lib/whitelabel";

// Shown on sales calls by screen share. Not linked from the nav or the sitemap.
export const metadata: Metadata = {
  title: `The review flow | ${NAME}`,
  description: "What happens after every job: the texts your customer gets, and what lands on your phone.",
  robots: { index: false, follow: false },
};

const SAMPLE = { customer: "Josh", business: "Sunny Gardening Service" };
// The add-on example was made for a different sample name than the sign and the meme.
const SCENE_CUSTOMER = "Ulysses";
const SCENES = [
  ["Landscaping", "name mowed into the lawn"],
  ["Pressure washing", "name washed into the driveway"],
  ["Concrete", "name written in fresh cement"],
  ["Roofing", "name laid out in shingles"],
  ["Window cleaning", "name drawn in the suds"],
];
const SOURCES = ["Square", "Stripe", "Calendly", "Acuity", "Your CRM", "Or type the name in"];

function Step({ n, when, title, children, side }: { n: string; when: string; title: string; children: ReactNode; side?: ReactNode }) {
  return (
    <li className="sticker p-5 md:p-8">
      <div className={side ? "grid items-center gap-6 md:grid-cols-[1fr_300px] md:gap-10" : ""}>
        <div>
          <div className="flex items-center gap-3">
            <span className="display grid h-12 w-12 flex-none place-items-center rounded-full bg-ink text-2xl text-sun">{n}</span>
            <span className="rounded-full border border-line bg-sun px-3 py-0.5 text-[12px] font-extrabold uppercase tracking-wide">{when}</span>
          </div>
          <h2 className="mt-5 text-[1.7rem] md:text-[2.2rem]">{title}</h2>
          <div className="mt-3 max-w-[34rem] text-[17px] leading-relaxed">{children}</div>
        </div>
        {side}
      </div>
    </li>
  );
}

/** Four-point sparkle, the usual mark for AI-made content. */
function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M10 2.5l1.9 5.6a3 3 0 0 0 1.9 1.9l5.7 2-5.7 1.9a3 3 0 0 0-1.9 1.9L10 21.5l-1.9-5.7a3 3 0 0 0-1.9-1.9L.5 12l5.7-2a3 3 0 0 0 1.9-1.9L10 2.5z" />
      <path d="M19.5 1l.8 2.3a1.5 1.5 0 0 0 .9.9l2.3.8-2.3.8a1.5 1.5 0 0 0-.9.9L19.5 9l-.8-2.3a1.5 1.5 0 0 0-.9-.9L15.5 5l2.3-.8a1.5 1.5 0 0 0 .9-.9L19.5 1z" />
    </svg>
  );
}

function Phone({ text, img, alt, w, h, ai }: { text: string; img: string; alt: string; w: number; h: number; ai?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[28px] border border-line-strong bg-white p-3 shadow-sm">
      <p className="rounded-2xl bg-[#e9e9eb] px-3 py-2 text-[13px] leading-snug">{text} <span className="text-[#0a66c2]">g.page/r/…/review</span></p>
      <div className="relative mt-2 w-[92%]">
        <Image src={img} alt={alt} width={w} height={h} className="block h-auto w-full rounded-2xl border border-line" sizes="280px" />
        {ai && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-ink/85 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-sun backdrop-blur">
            <Sparkle className="h-3.5 w-3.5" /> AI generated
          </span>
        )}
      </div>
    </div>
  );
}

function Buzz({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[300px] items-start gap-3 rounded-2xl border border-line-strong bg-white p-3 shadow-sm">
      <Image src={MASCOT} alt="" width={36} height={36} className="flex-none" />
      <p className="text-[14px] leading-snug"><b className="block">{title}</b>{body}</p>
    </div>
  );
}

function Wire() {
  return <li aria-hidden="true" className="mx-auto h-8 w-0.5 bg-ink md:h-10" />;
}

export default function ReviewPitch() {
  return (
    <main className="fun min-h-dvh overflow-x-hidden">
      <header className="mx-auto flex max-w-4xl items-center gap-2 px-5 pt-5">
        <Image src={MASCOT} alt="" width={44} height={44} priority />
        <span className="display text-2xl">{NAME}</span>
      </header>

      <section className="mx-auto max-w-4xl px-5 pb-16 pt-8 md:pt-12">
        <p className="inline-block rounded-full border border-line bg-white px-3 py-0.5 text-[12px] font-extrabold uppercase tracking-wide">The review flow</p>
        <h1 className="mt-4 max-w-[16ch] text-[2.5rem] leading-[1] [text-wrap:balance] sm:text-[3.4rem] md:text-[4rem]">Job done. <span className="hi">Google review in.</span></h1>
        <p className="mt-5 max-w-[38rem] text-lg leading-relaxed sm:text-xl">It runs on its own after every job. The only thing you ever do is stop a text or read a review.</p>

        <ol className="mt-10">
          <Step n="1" when="Job finished" title="Your customer comes in">
            <p>Every finished job, booking or payment sends us the customer&rsquo;s name and number. Past customers can come in too, from a list.</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {SOURCES.map((s) => <li key={s} className="rounded-full border border-line-strong bg-white px-3 py-1 text-[13px] font-bold">{s}</li>)}
            </ul>
          </Step>
          <Wire />

          <Step n="2" when="First 2 hours" title="You get a heads up" side={<Buzz title={`${SAMPLE.customer} gets a review text in 2 hours`} body="Rough job? Stop it before it sends." />}>
            <p>Your phone buzzes. If the job went sideways, tap <b>Don&rsquo;t send</b>. If it went fine, do nothing.</p>
          </Step>
          <Wire />

          <Step
            n="3"
            when="2 hours later"
            title="The sign text"
            side={<Phone text={`Hi ${SAMPLE.customer}, thank you for trusting ${SAMPLE.business}! We would love to hear about your experience. It only takes 30 seconds:`} img="/reviewpitch/sign.jpg" alt={`A crew member holding a sign with the name ${SAMPLE.customer} written on it`} w={600} h={720} />}
          >
            <p>Your customer gets your Google link and a picture of your crew holding a sign with <b>their name</b> on it. We make the picture for every customer from one photo of your crew.</p>
          </Step>
          <Wire />

          <Step n="4" when="Every hour" title="We watch your Google page">
            <p>The moment their review lands, the texts stop, your phone buzzes, and a reply goes up on Google within the hour. Anything 3 stars or under, you get a text right away.</p>
            <div className="mt-4 max-w-[26rem] rounded-xl border border-line bg-paper p-4 text-[14px] leading-relaxed">
              <span className="stars text-base">★★★★★</span> <b>{SAMPLE.customer} R.</b><br />The yard looks amazing. Loved the sign!
              <p className="mt-2 border-l-[3px] border-leaf pl-3"><b>Reply:</b> Thank you, {SAMPLE.customer}! See you next month.</p>
            </div>
          </Step>
          <Wire />

          <Step
            n="5"
            when="No review yet"
            title="Two more nudges"
            side={<Phone text={`${SAMPLE.customer}, we’re not okay over here at ${SAMPLE.business}. A quick review would really cheer us up. Takes 30 seconds:`} img="/reviewpitch/meme.jpg" alt={`Meme of a crew member crying, captioned: when ${SAMPLE.customer} hasn't left me a review`} w={686} h={720} />}
          >
            <p><b>Day 3:</b> the meme, with their name on it. <b>Day 10:</b> one short last text with the link. After that they never get another one.</p>
          </Step>
        </ol>

        <h2 id="addon" className="mt-14 scroll-mt-6 text-[1.7rem] md:text-[2.2rem]">Add-on: <span className="hi">the custom picture</span></h2>
        <div className="sticker mt-8 p-5 md:mt-10 md:p-8">
          <div className="grid items-center gap-6 md:grid-cols-[1fr_300px] md:gap-10">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-0.5 text-[12px] font-extrabold uppercase tracking-wide text-sun"><Sparkle className="h-3.5 w-3.5" /> AI add-on</span>
                <span className="rounded-full border border-line bg-sun px-3 py-0.5 text-[12px] font-extrabold uppercase tracking-wide">Replaces the sign in step 3</span>
              </div>
              <h3 className="mt-5 text-[1.7rem] md:text-[2.2rem]">Their name, built into the job</h3>
              <div className="mt-3 max-w-[34rem] text-[17px] leading-relaxed">
                <p>Instead of the sign, your customer gets a picture made only for them: your crew on a job like theirs, with <b>their name worked into the scene</b>. For a landscaper, that is the name mowed into the lawn.</p>
                <p className="mt-3">We make a new one with AI for every customer, starting from a real photo of your crew. Nobody has been sent one of these before, so it gets looked at. Everything else in the flow runs the same.</p>
                <ul className="mt-4 grid gap-2 text-[14px]">
                  {SCENES.map(([trade, scene]) => <li key={trade} className="rounded-xl border border-line-strong bg-white px-3 py-1.5"><b>{trade}:</b> {scene}</li>)}
                </ul>
                <p className="mt-4 text-[15px] font-bold text-ink-soft">It costs more than the sign, because every picture is made from scratch.</p>
              </div>
            </div>
            <Phone text={`Hi ${SCENE_CUSTOMER}, thank you for trusting ${SAMPLE.business}! We would love to hear about your experience. It only takes 30 seconds:`} img="/reviewpitch/scene.jpg" alt={`A gardener giving a thumbs up on a front lawn with the name ${SCENE_CUSTOMER} mowed into the grass`} w={720} h={960} ai />
          </div>
        </div>

        <p className="mt-8 text-[13px] text-ink-mute">The sign and the meme are real output from the system for a sample customer named {SAMPLE.customer}. The custom picture is an example of the add-on, made for a customer named {SCENE_CUSTOMER}.</p>
      </section>
    </main>
  );
}
