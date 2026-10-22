import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { tr } from "@/lib/i18n-server";
import { createBusiness } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewClient({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await tr();
  const { error } = await searchParams;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("New client")}</h1>
          <p className="page-sub">{t("Starts on the 7-day trial unless you change it. Everything else is set up on their page after.")}</p>
        </div>
        <Link href="/admin/clients" className="obtn">{t("Cancel")}</Link>
      </div>
      {error && <p className="notice">{error}</p>}
      <form action={createBusiness} className="panel" style={{ marginTop: 20, maxWidth: 760 }}>
        <div className="form-grid">
          <input name="name" placeholder={t("Business name")} className="ofield" required autoFocus />
          <input name="owner_name" placeholder={t("Owner name")} className="ofield" />
          <input name="email" type="email" placeholder={t("Login email")} className="ofield" required />
          <input name="password" type="text" placeholder={t("App password (8+ characters)")} className="ofield" required minLength={8} />
          <input name="owner_phone" placeholder={t("Owner cell")} className="ofield" />
          <input name="review_link" placeholder={t("Google review link (https://g.page/r/…)")} className="ofield" />
          <select name="status" className="ofield" defaultValue="trial">
            <option value="trial">{t("7-day trial")}</option>
            <option value="active">{t("Active")}</option>
            <option value="paused">{t("Paused")}</option>
          </select>
          <button className="obtn primary">{t("Create client")}</button>
        </div>
      </form>
    </>
  );
}
