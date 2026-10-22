import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { markOpened } from "@/lib/requests";
import { loadGate, rateRequest, GOOD } from "@/lib/feedback";
import { gateUrl, firstName } from "@/lib/template";
import { baseUrl } from "@/lib/template";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Q = { stars?: string; thanks?: string };

/**
 * The link in the text. With the gate off it records the tap and sends the
 * customer to Google. With it on, the page asks for stars first: 4 and 5 go to
 * Google, 1 to 3 get a private note to the owner. No JavaScript on purpose: the
 * stars are plain links and the note is a plain form, so it works on any phone
 * and through the business's own domain (site rewrites /review/:code to here).
 */
export default async function GatePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Q> }) {
  const { code } = await params;
  const q = await searchParams;
  const g = await loadGate(code);
  if (!g || !g.b.review_link) return <Shell><p className="text-center text-ink-soft">This link isn&rsquo;t valid anymore.</p></Shell>;
  const { r, b } = g;

  if (!b.gate_enabled) {
    await markOpened(code);
    redirect(b.review_link);
  }

  const first = firstName(r.customer_name);
  const stars = Number(q.stars ?? 0);

  if (q.thanks) {
    return (
      <Shell business={b.name} logo={b.logo_url}>
        <h1 className="font-display text-[26px] leading-tight">Thank you{first ? `, ${first}` : ""}.</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">We got your note and will be in touch to make it right.</p>
      </Shell>
    );
  }

  if (stars >= 1 && stars <= 5) {
    await rateRequest(r, b, stars);
    if (stars >= GOOD) redirect(b.review_link);
    return (
      <Shell business={b.name} logo={b.logo_url}>
        <Stars filled={stars} />
        <h1 className="mt-4 font-display text-[24px] leading-tight">We&rsquo;re sorry we missed the mark{first ? `, ${first}` : ""}.</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">Tell us what happened so we can make it right.</p>
        <form method="post" action={`${baseUrl()}/api/feedback/${code}`} className="mt-5">
          <textarea name="comment" required rows={5} maxLength={1500} placeholder="What went wrong?" className="w-full resize-none rounded-2xl border border-line-strong bg-canvas px-4 py-3 text-[16px] leading-relaxed outline-none focus:border-ink" />
          <button type="submit" className="mt-4 h-13 w-full rounded-2xl bg-ink px-5 text-[16px] font-bold text-white">Send</button>
        </form>
        <p className="mt-4 text-center text-[13px] text-ink-mute"><a href={gateUrl(code, b)} className="underline">Back to the stars</a></p>
      </Shell>
    );
  }

  await markOpened(code);
  return (
    <Shell business={b.name} logo={b.logo_url}>
      <h1 className="font-display text-[26px] leading-tight">How did we do{first ? `, ${first}` : ""}?</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">Tap a star. It takes five seconds.</p>
      <div className="mt-6 flex justify-between gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <a key={n} href={`?stars=${n}`} aria-label={`${n} star${n === 1 ? "" : "s"}`} className="grid h-14 w-14 place-items-center rounded-2xl border border-line-strong bg-canvas active:bg-sun-soft">
            <Star />
          </a>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[12px] font-semibold text-ink-mute"><span>Not great</span><span>Excellent</span></div>
    </Shell>
  );
}

function Star({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      <path d="M12 2.5l2.9 6.2 6.7.8-4.9 4.7 1.3 6.7L12 17.6 6 20.9l1.3-6.7L2.4 9.5l6.7-.8z" fill={filled ? "#feb925" : "#fff3d1"} stroke="#111" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Stars({ filled }: { filled: number }) {
  return <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <Star key={n} filled={n <= filled} />)}</div>;
}

function Shell({ children, business, logo }: { children: React.ReactNode; business?: string; logo?: string }) {
  return (
    <main className="min-h-dvh bg-ground px-4 py-8">
      <div className="mx-auto max-w-[420px]">
        {business && (
          <div className="mb-5 flex items-center gap-3">
            {logo ? <img src={logo} alt="" className="h-11 w-11 rounded-xl border border-line object-cover" /> : null}
            <p className="text-[15px] font-bold">{business}</p>
          </div>
        )}
        <div className="rounded-3xl border border-line bg-canvas p-6 shadow-[0_2px_0_#e6e3dc]">{children}</div>
      </div>
    </main>
  );
}
