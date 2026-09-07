import { requireSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { getModelAttribution, type ModelAttributionReport } from "@/lib/modelAttr";
import SampleDataEmpty from "../SampleDataEmpty";
import FeatureGate from "../FeatureGate";
import { fetchOrFixture } from "@/lib/featureAccess";

export const dynamic = "force-dynamic";

const fmtPct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
const fmtN = (n: number) => n.toLocaleString();
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what a working attribution table looks like, not an empty/blank one.
const GLIMPSE_REPORT: ModelAttributionReport = {
  windowDays: 30,
  bestModel: "claude-sonnet-4-6",
  worstModel: "gpt-4o-mini",
  models: [
    { model_id: "claude-sonnet-4-6", runs: 4820, errors: 96, errorRate: 0.02, avgLatencyMs: 1120, p95LatencyMs: 2400, totalTokens: 7_896_800, avgTokensPerRun: 1638, trend: "improving" },
    { model_id: "gpt-4o", runs: 3110, errors: 187, errorRate: 0.06, avgLatencyMs: 1480, p95LatencyMs: 3100, totalTokens: 5_722_400, avgTokensPerRun: 1840, trend: "stable" },
    { model_id: "gpt-4o-mini", runs: 1240, errors: 149, errorRate: 0.12, avgLatencyMs: 890, p95LatencyMs: 2000, totalTokens: 1_054_000, avgTokensPerRun: 850, trend: "degrading" },
  ],
};

export default async function ModelsPage() {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Trial-aware effective plan (session.orgPlan), not the raw orgs.plan column —
  // that column stays "free" for the whole trial, which would deny a trialing org
  // the very features its trial grants.
  const allowed = demo || can(session.orgPlan, "model_attribution");

  const report = await fetchOrFixture<ModelAttributionReport | null>(
    allowed, GLIMPSE_REPORT, () => getModelAttribution(session.orgId, 30)
  );

  const totalAttributedRuns = report ? report.models.reduce((s, m) => s + m.runs, 0) : 0;

  const body = report && report.models.length > 0 ? (
    <>
      {(report.bestModel || report.worstModel) && (
        <div className="kpi-row models-kpi-row">
          {report.bestModel && (
            <div className="kpi">
              <div className="kpi-k">Most reliable</div>
              <div className="kpi-v mono models-kpi-v">
                {report.bestModel}
              </div>
              <div className="kpi-sub mono">
                {fmtPct(report.models.find((m) => m.model_id === report.bestModel)?.errorRate ?? 0)} error rate
              </div>
            </div>
          )}
          {report.worstModel && report.worstModel !== report.bestModel && (
            <div className="kpi" data-tone="rose">
              <div className="kpi-k">Highest error rate</div>
              <div className="kpi-v mono models-kpi-v">
                {report.worstModel}
              </div>
              <div className="kpi-sub mono">
                {fmtPct(report.models.find((m) => m.model_id === report.worstModel)?.errorRate ?? 0)} error rate
              </div>
            </div>
          )}
        </div>
      )}

      <section className="dash-panel">
        <div className="dash-panel-h">Models · by run count</div>
        <div className="table-wrap">
          <table className="appc-table">
            <thead>
              <tr>
                <th>Model</th><th>Runs</th><th>Error rate</th><th>Avg latency</th><th>p95</th><th>Avg tokens</th><th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {report.models.map((m) => (
                <tr key={m.model_id}>
                  <td className="mono models-model-id">{m.model_id}</td>
                  <td className="mono">{fmtN(m.runs)}</td>
                  <td className={`mono${m.errorRate > 0.1 ? " models-error-high" : ""}`}>
                    {fmtPct(m.errorRate)}
                  </td>
                  <td className="mono">{fmtMs(m.avgLatencyMs)}</td>
                  <td className="mono">{fmtMs(m.p95LatencyMs)}</td>
                  <td className="mono">{fmtN(m.avgTokensPerRun)}</td>
                  <td>
                    <span className={`pill ${m.trend === "improving" ? "pill-success" : m.trend === "degrading" ? "pill-error" : "pill-muted"}`}>
                      {m.trend}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="empty models-footer-note">
        Attribution links each model_id (from LLM events) to its run outcomes. A run using multiple models appears under each. Trend compares the first and second halves of the {report.windowDays}-day window.
      </p>
    </>
  ) : (
    <SampleDataEmpty
      badge="Model attribution · reliability"
      title="Know which model version is safer — before you ship."
      lead="As your fleet runs accumulate, Runback attributes error rates, latency, and token spend to each model version. The authoritative answer to 'did upgrading gpt-4o break our agent?' — not from logs, from replayed evidence."
      points={[
        "Per-model error rate, p95 latency, and token cost",
        "Improving vs. degrading trend across your window",
        "Best and worst model for your specific agent workload",
      ]}
    />
  );

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Model attribution</h1>
        <p className="appc-sub">
          {report && report.models.length > 0
            ? <>Model reliability · last {report.windowDays} days · {fmtN(totalAttributedRuns)} attributed runs</>
            : "Which model version caused that regression?"}
        </p>
      </div>

      <FeatureGate
        allowed={allowed}
        badge={planBadgeText("model_attribution")}
        title="Model reliability, version by version"
        lead="Runback mines your run history to surface per-model error rates, latency, and token cost — so you know before upgrading which version is safer for your specific workload. Available on Scale, Pro, and Enterprise."
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      >
        {body}
      </FeatureGate>
    </div>
  );
}
