import { NAME, MARK } from "@/lib/whitelabel";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { REPS } from "@/lib/reps";
import { currentLang, tr } from "@/lib/i18n-server";
import { adminLogin } from "../actions";
import { LangToggle } from "../LangToggle";

export const dynamic = "force-dynamic";
export const metadata = { title: `Sign in · ${NAME} Ops`, robots: { index: false, follow: false } };

// Pick who you are, type your password once. This browser then stays signed in.
export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ who?: string; wrong?: string }> }) {
  if (await isAdmin()) redirect("/admin");
  const [q, t, lang] = await Promise.all([searchParams, tr(), currentLang()]);
  const who = REPS.find((r) => r.key === q.who)?.key ?? "";
  // The App Review copy of the board (HM_DEMO=1, its own database of made-up clients), and the
  // link to it that the iPhone app shows under the sign-in so Apple can review without real data.
  const demo = process.env.HM_DEMO === "1";
  const inApp = ((await headers()).get("user-agent") ?? "").includes("HMOpsApp");
  return (
    <div className="gate">
      <form action={adminLogin} className="gate-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK} alt="" width={34} height={34} />
          <div><div className="brand-name" style={{ fontSize: "1.05rem", color: "var(--o-ink)" }}>{NAME} Ops</div><div className="page-sub" style={{ marginTop: 0 }}>{t("Sign in once. This browser remembers you.")}</div></div>
        </div>
        <div className="who">
          {REPS.map((r) => (
            <label key={r.key}>
              <input type="radio" name="who" value={r.key} defaultChecked={r.key === who || (!who && r.key === REPS[0].key)} required />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.photo} alt="" />
              {r.name}
            </label>
          ))}
        </div>
        <label className="olabel">{t("Password")}</label>
        <input name="password" type="password" className="ofield" autoFocus autoComplete="current-password" required />
        {demo && <p className="notice" style={{ background: "var(--accent-soft)", borderColor: "#bfdbfe", color: "var(--accent)" }}>{t("Demo board: every client, lead and number here is sample data.")}</p>}
        {q.wrong && <p className="notice">{t("That password is not right.")}</p>}
        <button className="obtn primary" style={{ width: "100%", height: 38, marginTop: 16 }}>{t("Sign in")}</button>
      </form>
      <LangToggle lang={lang} />
    </div>
  );
}
