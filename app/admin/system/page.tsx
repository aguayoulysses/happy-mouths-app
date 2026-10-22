import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { systemChecks } from "@/lib/health";
import { tr } from "@/lib/i18n-server";
import { runJob } from "../actions";

export const dynamic = "force-dynamic";

export default async function System() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await tr();
  const [checks, runs, queued, team] = await Promise.all([
    systemChecks(),
    all<{ name: string; ok: number; detail: string; created_at: string }>("SELECT name, ok, detail, created_at FROM cron_runs ORDER BY id DESC LIMIT 12"),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE status='queued'"),
    all<{ name: string; last_seen: string | null }>("SELECT u.name, (SELECT MAX(last_seen) FROM ops_sessions s WHERE s.user_id=u.id) AS last_seen FROM ops_users u ORDER BY u.id"),
  ]);
  const services = checks.filter((c) => !c.label.startsWith("Job:"));
  const jobs = checks.filter((c) => c.label.startsWith("Job:"));
  const down = checks.filter((c) => !c.ok).length;
  const q = Number(queued?.n ?? 0);
  const Row = ({ c }: { c: (typeof checks)[number] }) => (
    <div className="check-row">
      <span className={`check-dot ${c.ok ? "" : "bad"}`} />
      <div style={{ flex: 1, minWidth: 0 }}><div className={`check-name ${c.ok ? "" : "bad"}`}>{t(c.label.replace("Job: ", ""))}</div><div className="check-detail">{t(c.detail)}</div></div>
      {c.label.startsWith("Job: ") && <form action={runJob}><input type="hidden" name="job" value={c.label.replace("Job: ", "")} /><button className="obtn">{t("Run now")}</button></form>}
    </div>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("System")}</h1>
          <p className="page-sub">{down ? t.n(down, "{n} thing needs fixing", "{n} things need fixing") : t("Everything is running")} · {t.n(q, "{n} text scheduled", "{n} texts scheduled")}</p>
        </div>
      </div>
      <div className="two-col" style={{ marginTop: 22 }}>
        <div className="panel"><div className="panel-title">{t("Connections")}</div>{services.map((c) => <Row key={c.label} c={c} />)}</div>
        <div className="panel"><div className="panel-title">{t("Scheduled jobs")}</div>{jobs.map((c) => <Row key={c.label} c={c} />)}</div>
      </div>
      <div className="two-col" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-title">{t("Recent runs")}</div>
          {runs.map((r, i) => (
            <div key={i} className="check-row">
              <span className={`check-dot ${r.ok ? "" : "bad"}`} />
              <div><div className="check-name">{r.name} <span className="faint" style={{ fontWeight: 400 }}>{r.created_at}</span></div><div className="check-detail">{r.detail.slice(0, 160)}</div></div>
            </div>
          ))}
          {!runs.length && <p className="muted">{t("No runs recorded yet.")}</p>}
        </div>
        <div className="panel">
          <div className="panel-title">{t("Team")}</div>
          {team.map((tm) => (
            <div key={tm.name} className="check-row"><span className="check-dot" /><div><div className="check-name">{tm.name}</div><div className="check-detail">{tm.last_seen ? t("Last here {when} UTC", { when: tm.last_seen }) : t("Has not signed in yet")}</div></div></div>
          ))}
          {!team.length && <p className="muted">{t("Nobody has signed in yet.")}</p>}
          <p className="footnote">{t("Each person signs in once per browser and stays signed in. A new teammate picks their name on the sign-in page and sets their own password with the team code.")}</p>
        </div>
      </div>
    </>
  );
}
