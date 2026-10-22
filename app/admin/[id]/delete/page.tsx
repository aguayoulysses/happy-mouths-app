import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { one } from "@/lib/db";
import { tr } from "@/lib/i18n-server";
import { deleteClient } from "./actions";
import { NAME } from "@/lib/whitelabel";

export const dynamic = "force-dynamic";

// Confirmation step before a client is erased. Typing the business name is the safety catch.
export default async function DeleteClient({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await tr();
  const { id } = await params;
  const { error } = await searchParams;
  const b = await one<{ id: number; name: string; status: string; sms_number: string }>("SELECT id, name, status, sms_number FROM businesses WHERE id=?", [Number(id)]);
  if (!b) redirect("/admin/clients");
  const [customers, reviews] = await Promise.all([
    one<{ n: number }>("SELECT COUNT(*) AS n FROM customers WHERE business_id=?", [b.id]),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM reviews WHERE business_id=?", [b.id]),
  ]);

  return (
    <main className="mx-auto max-w-xl px-5 py-8">
      <Link href={`/admin/${b.id}`} className="text-sm text-ink-soft hover:text-ink">{t("← Back to {name}", { name: b.name })}</Link>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{t("Delete {name}?", { name: b.name })}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        {t("This erases the client and everything attached to them in {brand}: {a} customers, {b} synced reviews, texts, chat, photos, documents and their dashboard login. It cannot be undone. If they might come back, set their status to cancelled instead.", { brand: NAME, a: Number(customers?.n ?? 0), b: Number(reviews?.n ?? 0) })}
      </p>
      {b.sms_number && (
        <p className="mt-3 rounded-lg border border-line bg-sun-soft p-3 text-sm">
          {t("They have a texting number ({num}). Deleting here does not release it in Twilio. Release it there so it stops costing money.", { num: b.sms_number })}
        </p>
      )}
      <form action={deleteClient} className="mt-6 rounded-xl border border-line bg-white p-5">
        <input type="hidden" name="id" value={b.id} />
        <label className="block">
          <span className="text-sm font-bold">{t("Type {name} to confirm", { name: b.name })}</span>
          <input name="confirm" autoComplete="off" className="field mt-2" />
        </label>
        {error && <p className="mt-2 text-sm font-bold text-cherry">{t("The name did not match. Nothing was deleted.")}</p>}
        <button className="btn mt-4 h-10 px-4 text-sm font-bold" style={{ background: "#fd4347", borderColor: "#fd4347", color: "#fff" }}>{t("Delete forever")}</button>
      </form>
    </main>
  );
}
