import { NAME, BRAND } from "@/lib/whitelabel";

export default function Support() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Support</h1>
      <div className="mt-6 space-y-4 leading-relaxed text-ink-soft">
        <p>Email <a href={`mailto:${BRAND.supportEmail}`} className="font-bold text-ink underline">{BRAND.supportEmail}</a> and a person answers, usually the same business day.</p>
        <p><strong className="text-ink">Got a text and want it to stop?</strong> Reply STOP. That&rsquo;s it.</p>
        <p><strong className="text-ink">Can&rsquo;t sign in?</strong> Email us from the address on the account and we&rsquo;ll reset your password.</p>
        <p><strong className="text-ink">Where is my Google review link?</strong> Search your business on Google, open your profile, tap &ldquo;Get more reviews&rdquo; and copy the link. Paste it in Settings.</p>
      </div>
    </main>
  );
}
