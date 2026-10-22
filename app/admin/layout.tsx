import type { ReactNode } from "react";
import { currentOps } from "@/lib/auth";
import { one } from "@/lib/db";
import { systemChecks } from "@/lib/health";
import { repFor } from "@/lib/reps";
import { currentLang, tr } from "@/lib/i18n-server";
import { adminLogout } from "./actions";
import { NAME, MARK } from "@/lib/whitelabel";
import { OpsNav } from "./OpsNav";
import { MobileTabs } from "./MobileTabs";
import { LangProvider } from "./LangProvider";
import { LangToggle } from "./LangToggle";
import "./ops.css";
import "./ops-premium.css";

export const metadata = { title: `${NAME} Ops`, robots: { index: false, follow: false } };

// The team's shell. Signed out, a page renders bare (only the sign-in does; every other page redirects there).
// The viewer's language (EN / ES toggle at the foot of the sidebar) wraps everything, server and client side.
export default async function OpsLayout({ children }: { children: ReactNode }) {
  const [me, lang, t] = await Promise.all([currentOps(), currentLang(), tr()]);
  if (!me) return <LangProvider lang={lang}><div className="ops" lang={lang}>{children}</div></LangProvider>;
  const [chat, replies, system] = await Promise.all([
    one<{ n: number }>("SELECT COUNT(*) AS n FROM team_messages t JOIN businesses b ON b.id=t.business_id WHERE t.sender='client' AND t.read_at IS NULL AND b.demo=0"),
    // Reviews that should have been answered by now (auto-reply posts within the hour of the sync).
    one<{ n: number }>("SELECT COUNT(*) AS n FROM reviews r JOIN businesses b ON b.id=r.business_id WHERE r.reply_comment='' AND b.status IN ('active','trial') AND r.review_name NOT LIKE 'accounts/demo/%' AND r.created_at < datetime('now','-2 hours')"),
    systemChecks(),
  ]);
  const rep = repFor(me.key);
  const n = { chat: Number(chat?.n ?? 0), replies: Number(replies?.n ?? 0), systemDown: system.filter((c) => !c.ok).length };
  return (
    <LangProvider lang={lang}>
      <div className="ops" lang={lang}>
        <div className="shell">
          <input type="checkbox" id="ops-more" className="more-toggle" hidden />
          <label htmlFor="ops-more" className="more-scrim" aria-hidden />
          <aside className="sidebar">
            <div className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MARK} alt="" width={30} height={30} />
              <span>
                <div className="brand-name">{NAME}</div>
                <div className="brand-sub">{t("Ops")}</div>
              </span>
            </div>
            <OpsNav chat={n.chat} replies={n.replies} systemDown={n.systemDown} />
            <div className="me">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rep.photo} alt="" />
              <div>
                <div className="me-name">{me.name}</div>
                <form action={adminLogout}><button>{t("Sign out")}</button></form>
              </div>
              <LangToggle lang={lang} />
            </div>
          </aside>
          <div className="main">{children}</div>
          <MobileTabs chat={n.chat} replies={n.replies} other={n.systemDown} />
        </div>
      </div>
    </LangProvider>
  );
}
