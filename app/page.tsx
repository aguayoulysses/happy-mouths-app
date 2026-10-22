import Image from "next/image";
import Link from "next/link";
import { BRAND, MARK, NAME } from "@/lib/whitelabel";

// Placeholder home page. Put your own marketing site here, or point the root domain elsewhere
// and keep this app on a subdomain. Business owners sign in at /app, the team at /admin.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-5 text-center">
      <Image src={MARK} alt="" width={72} height={72} priority />
      <h1 className="display mt-4 text-4xl">{NAME}</h1>
      <p className="mt-3 text-lg text-ink-soft">More Google reviews for local service businesses, on autopilot.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/app" className="btn-fun h-11 px-5">Business sign in</Link>
        <Link href="/reviewpitch" className="btn-fun ghost h-11 px-5">See how it works</Link>
      </div>
      <p className="mt-10 text-sm text-ink-mute">
        <Link href="/privacy" className="underline">Privacy</Link> · <Link href="/support" className="underline">Support</Link> · <a href={`mailto:${BRAND.supportEmail}`} className="underline">{BRAND.supportEmail}</a>
      </p>
    </main>
  );
}
