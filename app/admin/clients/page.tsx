import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { all } from "@/lib/db";
import { clientHealth, type Health } from "@/lib/health";
import { repFor } from "@/lib/reps";
import { tr } from "@/lib/i18n-server";
import { Avatar } from "../Avatar";

export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const LABEL: Record<Health, string> = { risk: "At risk", watch: "Watch", healthy: "Healthy", off: "Off" };

export default async function Clients({ searchParams }: { searchParams: Promise<{ show?: string; error?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await tr();
  const { show = "live", error } = await searchParams;
  const clients = await clientHealth();
  const extra = await all<{ id: number; rep_key: string; logo_url: string; website: string; site_ok: number; site_checked_at: string }>("SELECT id, rep_key, logo_url, website, site_ok, site_checked_at FROM businesses");
  const more = new Map(extra.map((e) => [Number(e.id), e]));
  const live = clients.filter((c) => c.health !== "off");
  const off = clients.filter((c) => c.health === "off");
  const list = show === "off" ? off : live;
  const FEATURE: Record<string, string> = { phone: "Phone", messages: "Texts", invoices: "Invoices", photos: "Photos" };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("All clients")}</h1>
          <p className="page-sub">{t("{n} live", { n: live.length })} · {t("{n} paused or cancelled", { n: off.length })}</p>
        </div>
        <Link href="/admin/clients/new" className="obtn primary">{t("+ New client")}</Link>
      </div>
      {error && <p className="notice">{error}</p>}

      <div className="pill-row" style={{ margin: "16px 0 12px" }}>
        <Link href="/admin/clients" className={`pill ${show !== "off" ? "on" : ""}`}>{t("Live")}<span className="count">{live.length}</span></Link>
        <Link href="/admin/clients?show=off" className={`pill ${show === "off" ? "on" : ""}`}>{t("Paused and cancelled")}<span className="count">{off.length}</span></Link>
      </div>

      <div className="table-box">
        <table>
          <thead>
            <tr>{["Client", "Health", "Website", "Owner", "Manager", "MRR", "Customers", "Reviews 30d", "Seen on Google", "Latest signal"].map((h) => <th key={h}>{t(h)}</th>)}</tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const m = more.get(c.id);
              const trend = c.views !== null && c.views_prev ? Math.round(((c.views - c.views_prev) / c.views_prev) * 100) : null;
              const on = Object.entries(c.features).filter(([, v]) => v).map(([k]) => t(FEATURE[k]));
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/${c.id}`} className="client-cell">
                      <Avatar logo={m?.logo_url ?? ""} name={c.name} />
                      <span style={{ minWidth: 0 }}>
                        <span className="client-name" style={{ whiteSpace: "nowrap" }}>{c.name}</span>
                        <div className="client-meta" style={{ whiteSpace: "nowrap" }}>{on.length ? t("Reviews + {list}", { list: on.join(", ") }) : t("Reviews only")}</div>
                        {c.chat_unread > 0 && <span className="badge risk" style={{ marginTop: 4 }}>{t.n(c.chat_unread, "{n} new message", "{n} new messages")}</span>}
                      </span>
                    </Link>
                  </td>
                  <td>{c.status === "trial" ? <span className="badge trial"><span className="dot" />{t("Trial")} · {t(LABEL[c.health])}</span> : <span className={`badge ${c.health}`}><span className="dot" />{c.health === "off" ? t(c.status) : t(LABEL[c.health])}</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {m?.website ? (
                      <>
                        <a href={m.website} target="_blank" rel="noreferrer" className="client-name" style={{ textDecoration: "underline" }}>{m.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
                        <div className={!m.site_checked_at ? "client-meta" : m.site_ok ? "trend-up" : "trend-down"}>{!m.site_checked_at ? t("not checked yet") : m.site_ok ? t("Up") : t("Down")}</div>
                      </>
                    ) : <span className="faint">{t("no site")}</span>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{c.owner_name || <span className="faint">{t("not set")}</span>}</td>
                  <td>{repFor(m?.rep_key).name}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>{usd(c.plan_cents / 100)}<div className="client-meta">{t("{n} mo", { n: c.months })} · {usd((c.plan_cents / 100) * c.months)} {t("LTV")}</div></td>
                  <td className="num">{c.customers}<div className={c.customers_14d ? "client-meta" : "trend-down"}>{c.customers_14d ? t("+{n} in 14d", { n: c.customers_14d }) : t("none in 14d")}</div></td>
                  <td className="num">{Math.max(c.reviews_30d, c.reviewed_30d)}<div className="client-meta">{t("{n} asked", { n: c.sent_30d })}</div></td>
                  <td className="num">{c.views ?? <span className="faint">{t("no data")}</span>}{trend !== null && <div className={trend < 0 ? "trend-down" : "trend-up"}>{trend < 0 ? "▼" : "▲"} {Math.abs(trend)}%</div>}</td>
                  <td style={{ minWidth: 230 }}>{c.flags[0] ? <><b>{t(c.flags[0].label)}.</b> <span className="muted">{t(c.flags[0].detail)}</span>{c.flags.length > 1 && <div className="client-meta">{t("+{n} more", { n: c.flags.length - 1 })}</div>}</> : <span className="muted">{t("All good")}</span>}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={10} className="muted" style={{ textAlign: "center", padding: 28 }}>{show === "off" ? t("Nobody paused or cancelled.") : t("No clients yet. Use + New client.")}</td></tr>}
          </tbody>
        </table>
      </div>

    </>
  );
}
