import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { one } from "@/lib/db";
import type { WelcomeBusiness } from "@/lib/welcome";
import { WelcomeView } from "../../WelcomeView";

// Ops only: exactly what this client's welcome page will look like, before anything is sent.
// Nothing is written (no token, no password change, no "opened" stamp). Linked from the Launch card.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome page preview", robots: { index: false, follow: false } };

export default async function WelcomePreview({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await params;
  const b = await one<WelcomeBusiness>("SELECT * FROM businesses WHERE id=?", [Number(id)]);
  if (!b) notFound();
  const pic = (k: string, key: string) => (key ? `/api/welcome-preview/${b.id}/${k}.jpg` : null);
  return <WelcomeView b={b} password={b.welcome_password || "tiger-mango-4821"} pics={{ sign: pic("sign", b.poster_template), meme: pic("meme", b.meme_template) }} preview />;
}
