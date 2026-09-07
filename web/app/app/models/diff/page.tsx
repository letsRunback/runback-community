import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { getModelDiff, listOrgModels, type ModelDiffReport } from "@/lib/modelDiff";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { planBadgeText } from "@/lib/plans";
import FeatureGate from "../../FeatureGate";
import NarrativeButton from "./NarrativeButton";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

const DEMO_REPORT: ModelDiffReport = {
  model_a: "gpt-4o", model_b: "claude-sonnet-4-6", window_days: 30,
  total_compared: 12, diverged: 2, divergence_rate: 0.167,
  critical_count: 1, policy_impact: true, token_delta_pct: -18.4,
  a_error_rate: 0.08, b_error_rate: 0.04, a_avg_tokens: 1840, b_avg_tokens: 1501,
  examples: [
    { agent_name: "loan-approval-agent",  model_a_status: "success", model_b_status: "error",   model_a_tokens: 2200, model_b_tokens: 1600, severity: "critical", policy_impact: true,
      divergence_category: "tool_changed", divergence_severity_score: 95, divergence_reason: "now answers directly instead of calling escalate_to_human" },
    { agent_name: "fraud-detection-agent", model_a_status: "error",   model_b_status: "success", model_a_tokens: 1850, model_b_tokens: 1420, severity: "minor",    policy_impact: false,
      divergence_category: "args_changed", divergence_severity_score: 38, divergence_reason: "flag_transaction(threshold: 500 → 750)" },
  ],
  cached: false,
  method: "counterfactual",
};

export default async function ModelDiffPage({ searchParams }: { searchParams: Promise<{ modelA?: string; modelB?: string; days?: string }> }) {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Trial-aware effective plan (session.orgPlan), not the raw orgs.plan column —
  // that column stays "free" for the whole trial, which would deny a trialing org
  // the very features its trial grants.
  const allowed = demo || can(session.orgPlan, "model_diff");

  const { modelA: modelAParam, modelB: modelBParam, days } = await searchParams;
  // Not entitled → pin the selectors to the illustrative pair so the glimpse
  // always has something real-shaped to show, instead of an empty selector form.
  const modelA = allowed ? modelAParam : DEMO_REPORT.model_a;
  const modelB = allowed ? modelBParam : DEMO_REPORT.model_b;
  const windowDays = Math.min(90, Math.max(7, parseInt(days ?? "30", 10)));

  const allModels = await listOrgModels(session.orgId, windowDays);
  let report: ModelDiffReport | null = null;

  if (!allowed) {
    // Illustrative only — a non-entitled org sees what a real report looks
    // like, not an empty box. Never shown to an entitled account, so it can
    // never contradict the real numbers this same org sees on other pages.
    report = DEMO_REPORT;
  } else if (modelA && modelB && modelA !== modelB) {
    report = await getModelDiff(session.orgId, modelA, modelB, windowDays, demo);
  }

  const pct    = (n: number) => `${(n * 100).toFixed(1)}%`;
  const tokFmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  const body = (
    <>
      {/* Selector */}
      <form method="get" className="md-form">
        <div className="md-field">
          <label className="md-label">Baseline</label>
          <select name="modelA" defaultValue={modelA ?? ""} className="md-select">
            <option value="">Select model</option>
            {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
            {DEMO_MODE && !allModels.includes("gpt-4o") && <option value="gpt-4o">gpt-4o</option>}
          </select>
        </div>
        <span className="md-arrow">→</span>
        <div className="md-field">
          <label className="md-label">Candidate</label>
          <select name="modelB" defaultValue={modelB ?? ""} className="md-select">
            <option value="">Select model</option>
            {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
            {DEMO_MODE && !allModels.includes("claude-sonnet-4-6") && <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>}
          </select>
        </div>
        <div className="md-field">
          <label className="md-label">Window</label>
          <select name="days" defaultValue={String(windowDays)} className="md-select">
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
        <button type="submit" className="btn-fill md-submit">Compare →</button>
      </form>

      {!report && !modelA && (
        <div className="appc-empty">Select two models above to see how their decisions differ on your production history.</div>
      )}
      {!report && modelA && modelB && (
        <div className="appc-empty">No overlapping run data for these models in the last {windowDays} days.</div>
      )}

      {report && (
        <>
          <p className="appc-sub mono" style={{ marginTop: "-0.5rem" }}>
            {report.method === "counterfactual"
              ? <><span className="pill pill-success">verified</span> Each run replayed live against the candidate model — real decisions, not an estimate.</>
              : <><span className="pill pill-muted">estimated</span> Compared from production history, not replayed — <Link href={UPGRADE_HREF} className="appc-link">Enterprise verifies via live replay →</Link></>}
          </p>
          {/* KPIs */}
          <div className="md-kpi-grid">
            {[
              { label: "Compared",        value: String(report.total_compared),                                              tone: "base"    },
              { label: "Diverged",         value: pct(report.divergence_rate),                                               tone: report.divergence_rate > 0.1 ? "rose" : "emerald" },
              { label: "Critical",         value: String(report.critical_count),                                             tone: report.critical_count > 0 ? "rose" : "emerald"    },
              { label: "Token delta",      value: `${report.token_delta_pct > 0 ? "+" : ""}${report.token_delta_pct.toFixed(1)}%`, tone: report.token_delta_pct < 0 ? "emerald" : "amber" },
            ].map(({ label, value, tone }) => (
              <div key={label} className="md-kpi">
                <div className="md-kpi-label">{label}</div>
                <div className={`md-kpi-val md-kpi-${tone}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Side-by-side model stats */}
          <div className="md-models">
            {([
              { label: report.model_a, errRate: report.a_error_rate, avgTok: report.a_avg_tokens, side: "A" },
              { label: report.model_b, errRate: report.b_error_rate, avgTok: report.b_avg_tokens, side: "B" },
            ] as const).map(({ label, errRate, avgTok, side }) => (
              <div key={side} className="md-model-card">
                <div className="md-model-name">Model {side} — <span className="mono">{label}</span></div>
                <div className="md-model-stats">
                  <div>
                    <div className="md-stat-label">error rate</div>
                    <div className={`md-stat-val ${errRate > 0.1 ? "md-stat-val--error" : "md-stat-val--ok"}`}>{pct(errRate)}</div>
                  </div>
                  <div>
                    <div className="md-stat-label">avg tokens</div>
                    <div className="md-stat-val">{tokFmt(avgTok)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Policy impact banner */}
          {report.policy_impact && (
            <div className="md-policy-banner">
              ⚠ Policy impact detected — at least one diverging agent class had policy-blocked runs.
            </div>
          )}

          {/* Divergence table */}
          {report.examples.length > 0 && (
            <>
              <h2 className="md-section-title">Diverging agent classes</h2>
              <div className="table-wrap">
                <table className="appc-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Model A</th>
                      <th>Model B</th>
                      <th>A tokens</th>
                      <th>B tokens</th>
                      <th>Severity</th>
                      {report.method === "counterfactual" && <th>What changed</th>}
                      {report.method === "counterfactual" && <th>Root cause</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {report.examples.map((ex, i) => (
                      <tr key={i}>
                        <td className="mono">{ex.agent_name}</td>
                        <td><span className={`pill pill-${ex.model_a_status === "error" ? "error" : "ok"}`}>{ex.model_a_status}</span></td>
                        <td><span className={`pill pill-${ex.model_b_status === "error" ? "error" : "ok"}`}>{ex.model_b_status}</span></td>
                        <td className="mono">{tokFmt(ex.model_a_tokens)}</td>
                        <td className="mono">{tokFmt(ex.model_b_tokens)}</td>
                        <td><span className={`pill pill-${ex.severity === "critical" ? "error" : "muted"}`}>{ex.severity}</span></td>
                        {report.method === "counterfactual" && (
                          <td style={{ maxWidth: "320px" }}>
                            {ex.divergence_category ? (
                              <>
                                <span className="mono" style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                  {ex.divergence_category.replace("_", " ")} · {ex.divergence_severity_score}
                                </span>
                                <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>{ex.divergence_reason}</div>
                              </>
                            ) : "—"}
                          </td>
                        )}
                        {report.method === "counterfactual" && (
                          <td style={{ maxWidth: "280px" }}>
                            {ex.run_id && ex.divergence_category ? (
                              <NarrativeButton runId={ex.run_id} modelA={report.model_a} modelB={report.model_b} windowDays={report.window_days} />
                            ) : "—"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {report.divergence_rate === 0 && (
            <div className="md-clean">
              ✓ No behavioral divergence across {report.total_compared} agent class{report.total_compared !== 1 ? "es" : ""}. These models behave equivalently on your production history.
            </div>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="appc">
      <Link href="/app/models" className="apprun-back mono">← Models</Link>
      <div className="appc-head">
        <h1 className="appc-h1">Model diff</h1>
        <p className="appc-sub">Compare behavioral divergence between two models on your production history.</p>
      </div>
      <FeatureGate
        allowed={allowed}
        badge={planBadgeText("model_diff")}
        title="See exactly where two models disagree"
        lead="Compare behavioral divergence between two models on your own production history — verified via live replay on Enterprise, estimated from history on Scale and Pro."
      >
        {body}
      </FeatureGate>
    </div>
  );
}
