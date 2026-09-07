import Link from "next/link";
import { requireSession, atLeast } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { getAdminClient } from "@/lib/supabase/admin";
import { listGates, type UpgradeGateReport } from "@/lib/upgradeGate";
import { listOrgModels } from "@/lib/modelDiff";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { planBadgeText } from "@/lib/plans";
import GateThresholds from "./GateThresholds";
import GateForm from "./GateForm";
import FeatureGate from "../../FeatureGate";
import { fetchOrFixture } from "@/lib/featureAccess";

export const dynamic = "force-dynamic";

const VERDICT_LABEL: Record<string, string> = {
  pass:    "Pass",
  warning: "Warning",
  fail:    "Fail",
  no_data: "No data",
};

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what a real gate run looks like, not an empty history list.
const GLIMPSE_GATE: UpgradeGateReport = {
  id: "glimpse", org_id: "glimpse", from_model: "gpt-4o", to_model: "claude-sonnet-4-6",
  total_tests: 10, passed: 8, failed: 1, changed: 2, pass_rate: 0.8, verdict: "warning",
  results: [
    { run_id: "g1", run_name: "loan-approval-agent", from_status: "gpt-4o", to_status: "reproduced", from_tokens: 2100, to_tokens: 0, passed: true, changed: false, change_type: "ok" },
    { run_id: "g2", run_name: "fraud-detection-agent", from_status: "gpt-4o", to_status: "diverged", from_tokens: 1850, to_tokens: 0, passed: false, changed: true, change_type: "decision_diverged", verdict: "frontier" },
    { run_id: "g3", run_name: "refund-eligibility-agent", from_status: "gpt-4o", to_status: "diverged", from_tokens: 1420, to_tokens: 0, passed: false, changed: true, change_type: "decision_diverged", verdict: "frontier" },
  ],
  created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  method: "counterfactual",
  pass_threshold: 0.95, warn_threshold: 0.80,
};

export default async function UpgradeGatePage() {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: orgRow } = await sb.from("orgs")
    .select("plan,gate_pass_threshold,gate_warn_threshold")
    .eq("id", session.orgId).maybeSingle();
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Trial-aware effective plan (session.orgPlan), not the raw orgs.plan column —
  // that column stays "free" for the whole trial, which would deny a trialing org
  // the very features its trial grants.
  const allowed = demo || can(session.orgPlan, "upgrade_gate");

  // Only fetch the org's real gates when it may actually see them — this
  // previously queried them unconditionally and then threw the result away
  // for a non-entitled org, paying for a read whose output could never render.
  const [gates, allModels] = await Promise.all([
    fetchOrFixture(allowed, [GLIMPSE_GATE], () => listGates(session.orgId)),
    listOrgModels(session.orgId, 30),
  ]);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const passThreshold = Number(orgRow?.gate_pass_threshold ?? 0.95);
  const warnThreshold = Number(orgRow?.gate_warn_threshold ?? 0.80);

  const body = (
    <>
      <GateThresholds canAdmin={atLeast(session.role, "admin")} passThreshold={passThreshold} warnThreshold={warnThreshold} />

      <GateForm allModels={allModels} />

      {/* Gate history */}
      {gates.length === 0 ? (
        <div className="appc-empty">No gates run yet. Select models above to run your first gate.</div>
      ) : (
        <div className="gate-list">
          {gates.map((gate) => <GateCard key={gate.id} gate={gate} pct={pct} />)}
        </div>
      )}
    </>
  );

  return (
    <div className="appc">
      <Link href="/app/models" className="apprun-back mono">← Models</Link>
      <div className="appc-head appc-head-row">
        <div>
          <h1 className="appc-h1">Upgrade gate</h1>
          <p className="appc-sub">Run your golden test suite against a candidate model before rolling it to production.</p>
        </div>
      </div>

      <FeatureGate
        allowed={allowed}
        badge={planBadgeText("upgrade_gate")}
        title="Know a model swap is safe before you ship it"
        lead="Run your golden test suite against a candidate model and see exactly what would change — verified via live replay on Enterprise, estimated from history on Scale and Pro."
      >
        {body}
      </FeatureGate>
    </div>
  );
}

function GateCard({ gate, pct }: { gate: UpgradeGateReport; pct: (n: number) => string }) {
  const verdictLabel = VERDICT_LABEL[gate.verdict] ?? gate.verdict;
  const passT = gate.pass_threshold ?? 0.95;
  const warnT = gate.warn_threshold ?? 0.80;
  return (
    <div className={`gate-card${gate.verdict === "fail" ? " gate-card--fail" : ""}`}>
      {/* Header */}
      <div className="gate-card-header">
        <span className={`gate-verdict-badge gate-verdict-badge--${gate.verdict}`}>{verdictLabel}</span>
        <span className="gate-card-models">{gate.from_model} → {gate.to_model}</span>
        <span className="mono" style={{ fontSize: "0.75rem", color: gate.method === "counterfactual" ? "var(--emerald)" : "var(--text-muted)" }}>
          {gate.method === "counterfactual" ? "verified via replay" : "estimated"}
        </span>
        <span className="gate-card-date">{new Date(gate.created_at).toLocaleDateString()}</span>
      </div>

      {/* Stats */}
      <div className="gate-stats">
        {[
          { label: "Tests",     value: String(gate.total_tests) },
          { label: "Passed",    value: String(gate.passed),    color: "var(--emerald)" },
          { label: "Failed",    value: String(gate.failed),    color: gate.failed > 0 ? "var(--rose)" : undefined },
          { label: "Changed",   value: String(gate.changed),   color: gate.changed > 0 ? "var(--amber)" : undefined },
          { label: "Pass rate", value: pct(gate.pass_rate),    color: gate.pass_rate >= passT ? "var(--emerald)" : gate.pass_rate >= warnT ? "var(--amber)" : "var(--rose)" },
        ].map(({ label, value, color }) => (
          <div key={label} className="gate-stat">
            <div className="gate-stat-label">{label}</div>
            <div className="gate-stat-value" style={color ? { color } : undefined}>{value}</div>
          </div>
        ))}
      </div>

      {/* Changed rows */}
      {gate.results.filter((r) => r.changed).length > 0 && (
        <div className="gate-changed">
          <div className="gate-changed-title">Changed tests</div>
          <div className="gate-changed-list">
            {gate.results.filter((r) => r.changed).slice(0, 5).map((r) => (
              <div key={r.run_id} className="gate-changed-row" title={r.verdict}>
                <span className="gate-changed-name">{r.run_name}</span>
                <span className="gate-changed-from">{r.from_status}</span>
                <span className="gate-changed-sep">→</span>
                <span className={r.to_status === "error" || r.to_status === "diverged" ? "gate-changed-to--err" : "gate-changed-to--ok"}>{r.to_status}</span>
                <span className="gate-changed-type">{r.change_type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
