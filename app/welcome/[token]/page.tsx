import { NAME } from "@/lib/whitelabel";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { businessForWelcome } from "@/lib/welcome";
import { WelcomeView } from "../WelcomeView";

// The private welcome page a client gets when ops presses "Send welcome" (lib/welcome.ts). One design for
// every client: their login, the app, the onboarding video, their own review pictures and their links.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `Welcome to ${NAME}`,
  description: "Your login, the app and a short walkthrough.",
  robots: { index: false, follow: false },
};

export default async function Welcome({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await businessForWelcome(token);
  if (!b) notFound();
  const pic = (k: string, key: string) => (key ? `/api/welcome/${token}/${k}.jpg` : null);
  return <WelcomeView b={b} password={b.welcome_password} pics={{ sign: pic("sign", b.poster_template), meme: pic("meme", b.meme_template) }} />;
}
