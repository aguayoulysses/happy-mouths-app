import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { one } from "@/lib/db";
import { clientHealth } from "@/lib/health";
import { tr } from "@/lib/i18n-server";
import { AnimatedNumber } from "./AnimatedNumber";
import { Avatar } from "./Avatar";

export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

// Dashboard: the numbers, then everything that needs a person, worst first.
export default async function Dashboard() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await tr();
  const [clients, queued] = await Promise.all([clientHealth(), one<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE status='queued'")]);
  const live = clients.filter((c) => c.health !== "off");
  const active = clients.filter((c) => c.status === "active");
  const trials = clients.filter((c) => c.status === "trial");
  // MRR = the plan price typed on each active client.
  const mrr = active.reduce((n, c) => n + c.plan_cents, 0) / 100;
  const risk = live.filter((c) => c.health === "risk");
  const watch = live.filter((c) => c.health === "watch");
  const reviews = live.reduce((n, c) => n + Math.max(c.reviews_30d, c.reviewed_30d), 0);
  const asked = live.reduce((n, c) => n + c.sent_30d, 0);
  const attention = live.flatMap((c) => c.flags.map((f) => ({ c, f }))).sort((a, b) => (a.f.level === b.f.level ? 0 : a.f.level === "red" ? -1 : 1));
  const q = Number(queued?.n ?? 0);
  const healthLabel = (h: string) => (h === "risk" ? t("At risk") : h === "watch" ? t("Watch") : t("Healthy"));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Dashboard")}</h1>
          <p className="page-sub">{t("{n} active", { n: active.length })} · {t("{n} on trial", { n: trials.length })} · {t.n(q, "{n} text scheduled", "{n} texts scheduled")}</p>
        </div>
        <Link href="/admin/clients/new" className="obtn">{t("+ New client")}</Link>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-num"><AnimatedNumber value={String(usd(mrr))} /></div><div className="stat-label">{t("MRR")}</div><div className="stat-note">{active.length ? t("{a} per active client", { a: usd(mrr / active.length) }) : t("no active clients yet")}</div></div>
        <div className="stat"><div className={`stat-num ${risk.length ? "bad" : ""}`}>{risk.length}</div><div className="stat-label">{t("At risk")}</div><div className="stat-note">{t("{n} more to watch", { n: watch.length })}</div></div>
        <div className="stat"><div className="stat-num"><AnimatedNumber value={String(reviews)} /></div><div className="stat-label">{t("Reviews, last 30 days")}</div><div className="stat-note">{t("across all clients")}</div></div>
        <div className="stat"><div className="stat-num"><AnimatedNumber value={String(asked)} /></div><div className="stat-label">{t("Customers asked, last 30 days")}</div><div className="stat-note">{asked ? t("{n}% left a review", { n: Math.round((reviews / asked) * 100) }) : t("nothing sent yet")}</div></div>
      </div>

      <div className="section-label">{t("Needs attention")} <span>{attention.length ? t("red first") : ""}</span></div>
      <div className="list-box">
        {attention.length === 0 && <p className="empty">{t("Nothing needs you. Every client has customers coming in, texts going out, and nobody waiting on a reply.")}</p>}
        {attention.map(({ c, f }, i) => (
          <Link key={i} href={`/admin/${c.id}${f.label.startsWith("Waiting on us") ? "#chat" : ""}`}>
            <div className={`attn-row ${f.level}`}>
              <span className="attn-name"><Avatar logo={c.logo_url} name={c.name} />{c.name}</span>
              <span className="attn-what">{t(f.label)}</span>
              <span className="attn-reason">{t(f.detail)}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="section-label">{t("Clients")} <span><Link href="/admin/clients" style={{ color: "var(--accent)" }}>{t("See all")}</Link></span></div>
      <div className="list-box">
        {live.length === 0 && <p className="empty">{t("No clients yet.")}</p>}
        {live.slice(0, 8).map((c) => (
          <Link key={c.id} href={`/admin/${c.id}`}>
            <div className="attn-row">
              <span className="attn-name"><Avatar logo={c.logo_url} name={c.name} />{c.name}</span>
              <span className={`badge ${c.health}`}><span className="dot" />{healthLabel(c.health)}</span>
              <span className="attn-reason">{t("{n} customers", { n: c.customers })}{c.customers_14d ? t(", {n} new in 14 days", { n: c.customers_14d }) : t(", none new in 14 days")} · {t("{n} reviews in 30 days", { n: Math.max(c.reviews_30d, c.reviewed_30d) })}</span>
              <span className="num muted">{usd(c.plan_cents / 100)}{t("/mo")}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
