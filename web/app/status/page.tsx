import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { uptimeStatus, STALE_AFTER_MINUTES } from "@/lib/uptime";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  path: "/status",
  title: "Status",
  description:
    "Runback availability: current state, response time, and daily uptime for the last 90 days. Recorded every five minutes against the database every request depends on.",
});

const LABEL = {
  ok: "All systems operational",
  degraded: "Degraded — availability unconfirmed",
  down: "Not serving",
} as const;

export default async function StatusPage() {
  const s = await uptimeStatus(90).catch(() => null);

  return (
    <>
      <Header />
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Status</span>

          {!s ? (
            <>
              <h1 className="mk-h2">Status is unavailable.</h1>
              <p className="mk-lead">
                The availability record itself could not be read, which is its own signal — treat this as
                degraded rather than healthy.
              </p>
            </>
          ) : (
            <>
              <h1 className="mk-h2" data-state={s.state}>
                {s.state === "ok" ? "✓ " : s.state === "down" ? "✗ " : "! "}
                {LABEL[s.state]}
              </h1>

              <p className="mk-lead" style={{ marginBottom: "1.6rem" }}>
                {s.state === "down" && (s.detail ?? "The last check did not pass.")}
                {s.state === "degraded" &&
                  `The last recorded check is older than ${STALE_AFTER_MINUTES} minutes, so availability is unconfirmed. Absence of a failure is not evidence of health, so this is not shown as operational.`}
                {s.state === "ok" &&
                  `Checked every five minutes against the database every request depends on. Last response ${s.lastLatencyMs ?? "—"}ms.`}
              </p>

              <div className="kpi-row" style={{ marginBottom: "2rem" }}>
                {/* Label the window by the data that exists, not by the window
                    we queried. "Uptime, 90 days: 100%" computed from one day of
                    checks is the kind of number that costs you the reader the
                    moment they notice — on the page whose only job is being
                    believed. */}
                <div className="kpi">
                  <div className="kpi-k">
                    Uptime, {s.days.length === 0 ? "no data yet"
                      : s.days.length === 1 ? "last 24 hours"
                      : `last ${s.days.length} days`}
                  </div>
                  <div className="kpi-v">{s.windowUptimePct === null ? "—" : `${s.windowUptimePct}%`}</div>
                  <div className="kpi-sub mono">
                    {s.days.reduce((n, d) => n + d.checks, 0).toLocaleString()} checks recorded
                    {s.days.length < 90 && " · recording began recently, so this is not yet a 90-day figure"}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-k">Last checked</div>
                  <div className="kpi-v" style={{ fontSize: "1.05rem" }}>
                    {s.lastCheckedAt ? new Date(s.lastCheckedAt).toUTCString() : "never"}
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="appc-table">
                  <thead>
                    <tr><th>Day (UTC)</th><th>Uptime</th><th>Checks</th><th>Failures</th><th>Median response</th></tr>
                  </thead>
                  <tbody>
                    {s.days.length === 0 ? (
                      <tr><td colSpan={5}>No checks recorded yet.</td></tr>
                    ) : (
                      s.days.map((d) => (
                        <tr key={d.day}>
                          <td className="mono">{d.day}</td>
                          <td data-tone={d.failures > 0 ? "rose" : "emerald"}>
                            {d.uptime_pct === null ? "—" : `${d.uptime_pct}%`}
                          </td>
                          <td className="mono appc-dim">{d.checks}</td>
                          <td className="mono appc-dim">{d.failures}</td>
                          <td className="mono appc-dim">{d.p50_ms === null ? "—" : `${d.p50_ms}ms`}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Stating the limitation is what makes the rest of the page worth reading. */}
              <p className="mk-lead" style={{ marginTop: "1.6rem", fontSize: "0.86rem" }}>
                <strong>How this is measured, and what it cannot show.</strong> A check runs every five
                minutes inside the deployment and exercises the database every request depends on — a
                process that is running but cannot reach Postgres is recorded as failing, not as healthy.
                Because the recorder runs inside the deployment, a total outage stops the recording rather
                than logging a failure: it appears as a gap, and this page reports an unconfirmed state
                instead of green. Anyone wanting independent verification can poll{" "}
                <code className="mono">/api/health</code>, which returns 503 when the service cannot serve.
              </p>
            </>
          )}
        </div>
      </section>
      <Footer />
    </>
  );
}
