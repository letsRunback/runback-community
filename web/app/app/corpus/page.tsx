import { requireSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/entitlements";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { getCorpusSignals, type CorpusOverview } from "@/lib/corpus";
import { planBadgeText } from "@/lib/plans";
import SampleDataEmpty from "../SampleDataEmpty";
import FeatureGate from "../FeatureGate";
import EditionLink from "@/components/EditionLink";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

const fmtPct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
const fmtN = (n: number) => n.toLocaleString();

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what real per-agent signals look like, not an empty table. No fixture like
// this existed in the file before; these numbers are made up for the glimpse.
const DEMO_SIGNALS: CorpusOverview = {
  signals: [
    { agent: "loan-approval-agent", runs: 482, errorRate: 0.18, orgErrorRate: 0.06, anomaly: "high_error", anomalyScore: 0.8, trend: "up", tokens: 812_000, avgTokens: 1685, orgAvgTokensPerRun: 1120, errRate7d: 0.21, errRatePrev7d: 0.09 },
    { agent: "fraud-detection-agent", runs: 1290, errorRate: 0.04, orgErrorRate: 0.06, anomaly: "token_spike", anomalyScore: 0.5, trend: "flat", tokens: 5_400_000, avgTokens: 4186, orgAvgTokensPerRun: 1120, errRate7d: 0.04, errRatePrev7d: 0.04 },
    { agent: "onboarding-agent", runs: 950, errorRate: 0.05, orgErrorRate: 0.06, anomaly: "healthy", anomalyScore: 0, trend: "flat", tokens: 980_000, avgTokens: 1031, orgAvgTokensPerRun: 1120, errRate7d: 0.05, errRatePrev7d: 0.05 },
    { agent: "support-agent", runs: 2140, errorRate: 0.03, orgErrorRate: 0.06, anomaly: "healthy", anomalyScore: 0, trend: "down", tokens: 1_500_000, avgTokens: 700, orgAvgTokensPerRun: 1120, errRate7d: 0.02, errRatePrev7d: 0.04 },
  ],
  orgErrorRate: 0.06,
  orgAvgTokensPerRun: 1120,
  totalRuns: 4862,
  windowDays: 14,
};

export default async function CorpusPage() {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Trial-aware effective plan — never the raw orgs.plan column, which stays
  // "free" during a trial and would lock a trialing org out of its own trial.
  const allowed = demo || can(session.orgPlan, "corpus");

  let data: CorpusOverview | null = null;
  let fleetOrgCount = 0;
  if (allowed) {
    // Independent lookups — fetch in parallel instead of two serialized
    // round trips.
    const [dataResult, fleetResult] = await Promise.all([
      getCorpusSignals(session.orgId).catch(() => null),
      // Fleet org count for flywheel narrative — from ad_fleet_stats
      sb
        .from("ad_fleet_stats")
        .select("org_count")
        .eq("metric", "error_rate")
        .eq("window_days", 30)
        .eq("vertical", "all")
        .maybeSingle()
        .then(({ data: fleetRow }: { data: { org_count?: number } | null }) => fleetRow?.org_count ?? 0)
        .catch(() => 0),
    ]);
    data = dataResult;
    fleetOrgCount = fleetResult;
  }

  // Not entitled → glimpse with illustrative signals instead of an empty table.
  const effective: CorpusOverview | null = allowed ? data : DEMO_SIGNALS;
  const showEmpty = allowed && (!data || data.signals.length === 0);

  const anomalous = effective ? effective.signals.filter((s) => s.anomaly !== "healthy") : [];
  const healthy = effective ? effective.signals.filter((s) => s.anomaly === "healthy") : [];

  const body = showEmpty ? (
    <SampleDataEmpty
      badge="Corpus · agent intelligence"
      title="Your cassette corpus is the product."
      lead="Every run you record becomes part of an appreciating corpus. Runback mines it to surface which agents have rising error rates, token spikes, or silent regressions — anomalies invisible from any single run."
      points={[
        "High-error agents flagged vs. your own baseline",
        "Error rate trending — catch regressions before they compound",
        "Token cost outliers — find agents silently burning budget",
      ]}
    />
  ) : effective ? (
    <>
      {fleetOrgCount > 1 && (
        <div className="corpus-flywheel">
          <span className="corpus-flywheel-icon">⟳</span>
          <span>
            <strong>{fleetOrgCount} orgs</strong> contribute anonymized signals to Runback&apos;s cross-org peer benchmarks (separate from the org-only signals below).{" "}
            <EditionLink href="/app/benchmark" className="corpus-fleet-link">View your fleet percentiles →</EditionLink>
          </span>
        </div>
      )}

      <div className="kpi-row corpus-kpi-row-3col">
        <div className="kpi">
          <div className="kpi-k">Your baseline error rate</div>
          <div className="kpi-v" data-tone={effective.orgErrorRate > 0.1 ? "rose" : undefined}>
            {fmtPct(effective.orgErrorRate)}
          </div>
          <div className="kpi-sub mono">{effective.signals.length} agents tracked</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Anomalous agents</div>
          <div className="kpi-v" data-tone={anomalous.length > 0 ? "amber" : undefined}>
            {anomalous.length}
          </div>
          <div className="kpi-sub mono">of {effective.signals.length} total</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Your baseline tokens / run</div>
          <div className="kpi-v">{fmtN(Math.round(effective.orgAvgTokensPerRun))}</div>
          <div className="kpi-sub mono">baseline</div>
        </div>
      </div>

      {anomalous.length > 0 && (
        <section className="dash-panel corpus-panel-spaced">
          <div className="dash-panel-h">
            Needs attention
            <span className="corpus-panel-count mono">
              {anomalous.length} agent{anomalous.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="table-wrap">
            <table className="appc-table">
              <thead>
                <tr>
                  <th>Agent</th><th>Signal</th><th>Error rate</th><th>vs. baseline</th><th>7d trend</th><th>Runs</th><th>Avg tokens</th>
                </tr>
              </thead>
              <tbody>
                {anomalous.map((s) => (
                  <tr key={s.agent}>
                    <td className="mono">{s.agent}</td>
                    <td>
                      <span className={`pill ${s.anomaly === "token_spike" ? "pill-muted" : "pill-error"}`}>
                        {s.anomaly === "high_error" ? "high error" : s.anomaly === "trending_up" ? "trending ▲" : "token spike"}
                      </span>
                    </td>
                    <td className="mono">{fmtPct(s.errorRate)}</td>
                    <td className="mono">
                      {s.orgErrorRate > 0 ? `${(s.errorRate / s.orgErrorRate).toFixed(1)}×` : "—"}
                    </td>
                    <td className={`mono${s.trend === "up" ? " corpus-trend-up" : s.trend === "down" ? " corpus-trend-down" : ""}`}>
                      {s.trend === "up" ? `▲ ${fmtPct(s.errRate7d)}` : s.trend === "down" ? `▼ ${fmtPct(s.errRate7d)}` : "—"}
                    </td>
                    <td className="mono">{fmtN(s.runs)}</td>
                    <td className="mono">{fmtN(Math.round(s.avgTokens))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="dash-panel corpus-panel-spaced">
        <div className="dash-panel-h">All agents</div>
        <div className="table-wrap">
          <table className="appc-table">
            <thead>
              <tr>
                <th>Agent</th><th>Health</th><th>Error rate</th><th>Runs</th><th>Total tokens</th>
              </tr>
            </thead>
            <tbody>
              {[...anomalous, ...healthy].map((s) => (
                <tr key={s.agent}>
                  <td className="mono">{s.agent}</td>
                  <td>
                    <span className={`pill ${s.anomaly === "healthy" ? "pill-success" : "pill-error"}`}>
                      {s.anomaly === "healthy" ? "healthy" : s.anomaly.replace("_", " ")}
                    </span>
                  </td>
                  <td className="mono">{fmtPct(s.errorRate)}</td>
                  <td className="mono">{fmtN(s.runs)}</td>
                  <td className="mono">{fmtN(s.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="empty corpus-footnote">
        Signals are derived from precomputed rollups — no individual run payloads are read. The corpus grows with every ingested run, making every signal more precise.
      </p>
    </>
  ) : null;

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Corpus signals</h1>
        <p className="appc-sub">
          {allowed && data
            ? <>Agent health intelligence · last {data.windowDays} days · {fmtN(data.totalRuns)} runs</>
            : "Agent health intelligence — mined from your own cassette corpus."}
        </p>
      </div>
      <FeatureGate
        allowed={allowed}
        badge={planBadgeText("corpus")}
        title="Agent health signals, per-agent"
        lead="As your runs accumulate, Runback mines the corpus to surface anomalies: agents with rising error rates, token cost spikes, or silent regressions — before they reach customers. Available on Pro and Enterprise."
        ctaHref={UPGRADE_HREF}
        ctaLabel="Upgrade →"
      >
        {body}
      </FeatureGate>
    </div>
  );
}
