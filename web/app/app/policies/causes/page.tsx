import { requireSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { getPolicyCausesReport, type PolicyCausesReport, type PolicyCauseStat } from "@/lib/policyCauses";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { planBadgeText } from "@/lib/plans";
import FeatureGate from "../../FeatureGate";

export const dynamic = "force-dynamic";

// ─── Demo data ────────────────────────────────────────────────────────────────
const DEMO_HEAT_MAP: PolicyCauseStat[] = [
  { policy_name: "pii-redaction",    agent: "loan-approval-agent", block_count: 214, run_count: 412, block_rate: 0.519, trend: 0.12 },
  { policy_name: "pii-redaction",    agent: "kyc-orchestrator",    block_count: 87,  run_count: 290, block_rate: 0.300, trend: -0.05 },
  { policy_name: "pii-redaction",    agent: "fraud-detection",     block_count: 42,  run_count: 380, block_rate: 0.111, trend: 0.03 },
  { policy_name: "pii-redaction",    agent: "report-generator",    block_count: 8,   run_count: 211, block_rate: 0.038, trend: -0.14 },
  { policy_name: "max-tool-calls",   agent: "fraud-detection",     block_count: 95,  run_count: 380, block_rate: 0.250, trend: 0.22 },
  { policy_name: "max-tool-calls",   agent: "kyc-orchestrator",    block_count: 61,  run_count: 290, block_rate: 0.210, trend: 0.08 },
  { policy_name: "max-tool-calls",   agent: "loan-approval-agent", block_count: 38,  run_count: 412, block_rate: 0.092, trend: -0.02 },
  { policy_name: "max-tool-calls",   agent: "report-generator",    block_count: 14,  run_count: 211, block_rate: 0.066, trend: 0.01 },
  { policy_name: "output-schema",    agent: "report-generator",    block_count: 77,  run_count: 211, block_rate: 0.365, trend: 0.31 },
  { policy_name: "output-schema",    agent: "loan-approval-agent", block_count: 29,  run_count: 412, block_rate: 0.070, trend: 0.05 },
  { policy_name: "output-schema",    agent: "fraud-detection",     block_count: 11,  run_count: 380, block_rate: 0.029, trend: -0.08 },
  { policy_name: "output-schema",    agent: "kyc-orchestrator",    block_count: 5,   run_count: 290, block_rate: 0.017, trend: 0.00 },
  { policy_name: "no-external-urls", agent: "report-generator",    block_count: 48,  run_count: 211, block_rate: 0.227, trend: 0.44 },
  { policy_name: "no-external-urls", agent: "fraud-detection",     block_count: 19,  run_count: 380, block_rate: 0.050, trend: 0.10 },
  { policy_name: "no-external-urls", agent: "loan-approval-agent", block_count: 7,   run_count: 412, block_rate: 0.017, trend: -0.03 },
  { policy_name: "no-external-urls", agent: "kyc-orchestrator",    block_count: 3,   run_count: 290, block_rate: 0.010, trend: 0.00 },
];

const DEMO_REPORT: PolicyCausesReport = {
  window_days: 30,
  total_blocks: DEMO_HEAT_MAP.reduce((s, r) => s + r.block_count, 0),
  unique_policies: 4,
  agents_with_high_block_rate: 3,
  by_policy: [
    { policy_name: "pii-redaction",    total_blocks: 351, affected_agents: 4, worst_agent: "loan-approval-agent", worst_rate: 0.519 },
    { policy_name: "max-tool-calls",   total_blocks: 208, affected_agents: 4, worst_agent: "fraud-detection",     worst_rate: 0.250 },
    { policy_name: "output-schema",    total_blocks: 122, affected_agents: 4, worst_agent: "report-generator",    worst_rate: 0.365 },
    { policy_name: "no-external-urls", total_blocks: 77,  affected_agents: 4, worst_agent: "report-generator",    worst_rate: 0.227 },
  ],
  heat_map: DEMO_HEAT_MAP,
  top_pair: DEMO_HEAT_MAP[0],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function cellColor(rate: number): string {
  if (rate === 0) return "transparent";
  if (rate <= 0.05) return "var(--amber-dim)";
  if (rate <= 0.20) return "rgba(244,63,94,0.15)";  // rose dim, deliberately stronger than --rose-dim for this mid-tier bucket
  return "rgba(244,63,94,0.35)";                     // rose bright
}

function cellTextColor(rate: number): string {
  if (rate === 0) return "rgba(255,255,255,0.15)";
  if (rate <= 0.05) return "var(--amber)";
  return "var(--rose)";
}

function trendBadge(trend: number) {
  if (Math.abs(trend) < 0.01) return null;
  const worse = trend > 0;
  return (
    <span className={`causes-trend ${worse ? "causes-trend-worse" : "causes-trend-better"}`}>
      {worse ? "↑" : "↓"} {Math.abs(trend * 100).toFixed(0)}%
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="causes-kpi-card">
      <div className="causes-kpi-label">{label}</div>
      <div className="causes-kpi-value">{value}</div>
      {sub && <div className="causes-kpi-sub">{sub}</div>}
    </div>
  );
}

function HeatMapTable({ report }: { report: PolicyCausesReport }) {
  const agents = [...new Set(report.heat_map.map((s) => s.agent))].sort();
  const policies = [...new Set(report.heat_map.map((s) => s.policy_name))].sort();

  // Index heat_map for O(1) lookup
  const idx = new Map<string, PolicyCauseStat>();
  for (const s of report.heat_map) idx.set(`${s.policy_name}|${s.agent}`, s);

  const rowTotals = new Map<string, number>();
  for (const p of policies) {
    rowTotals.set(p, report.heat_map.filter((s) => s.policy_name === p).reduce((sum, s) => sum + s.block_count, 0));
  }

  return (
    <div className="causes-hm-wrap">
      <table className="causes-hm-table">
        <thead>
          <tr>
            <th className="causes-hm-th">
              Policy
            </th>
            {agents.map((a) => (
              <th key={a} className="causes-hm-th causes-hm-th-agent">
                {a}
              </th>
            ))}
            <th className="causes-hm-th causes-hm-th-total">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy} className="causes-hm-tr">
              <td className="causes-hm-td-policy">{policy}</td>
              {agents.map((agent) => {
                const s = idx.get(`${policy}|${agent}`);
                const rate = s?.block_rate ?? 0;
                return (
                  <td
                    key={agent}
                    className="causes-hm-td-cell"
                    style={{ background: cellColor(rate), color: cellTextColor(rate) }}
                  >
                    {rate > 0 ? pct(rate) : "—"}
                  </td>
                );
              })}
              <td className="causes-hm-td-total">
                {rowTotals.get(policy) ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileRankedList({ heat_map, windowDays }: { heat_map: PolicyCauseStat[]; windowDays: number }) {
  const sorted = [...heat_map].sort((a, b) => b.block_rate - a.block_rate).slice(0, 20);
  return (
    <div className="causes-mob-wrap">
      <div className="causes-mob-title">
        Top policy × agent pairs · {windowDays}d window
      </div>
      <div className="causes-mob-list">
        {sorted.map((s) => (
          <div key={`${s.policy_name}|${s.agent}`} className="causes-mob-row">
            <span className="causes-mob-policy">{s.policy_name}</span>
            <span className="causes-mob-agent">{s.agent}</span>
            <span className="causes-mob-rate" style={{ color: cellTextColor(s.block_rate) }}>{pct(s.block_rate)}</span>
            <span className="causes-mob-count">{s.block_count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function PolicyCausesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session.email);

  let allowed = demo;
  if (!allowed) {
  // Trial-aware effective plan (session.orgPlan), not the raw orgs.plan column —
  // that column stays "free" for the whole trial, which would deny a trialing org
  // the very features its trial grants.
    allowed = can(session.orgPlan, "policy_causes");
  }

  const { days } = await searchParams;
  const windowDays = Math.min(90, Math.max(7, parseInt(days ?? "30", 10) || 30));

  const report = !allowed
    ? { ...DEMO_REPORT, window_days: windowDays }
    : demo
      ? { ...DEMO_REPORT, window_days: windowDays }
      : await getPolicyCausesReport(session.orgId, windowDays);

  const topPair = report.top_pair;

  const body = (
    <>
      {/* KPI row */}
      <div className="kpi-row kpi-row-3 causes-kpi-row">
        <KpiCard
          label={`Total blocks (${windowDays}d)`}
          value={String(report.total_blocks)}
          sub={`${Math.round(report.total_blocks / windowDays)}/day avg`}
        />
        <KpiCard
          label="Unique policies firing"
          value={String(report.unique_policies)}
          sub={report.by_policy[0] ? `Most: ${report.by_policy[0].policy_name}` : "—"}
        />
        <KpiCard
          label="Agents &gt;5% block rate"
          value={String(report.agents_with_high_block_rate)}
          sub="block rate threshold: 5%"
        />
      </div>

      {/* Top offender card */}
      {topPair && (
        <div className="causes-offender-wrap">
          <div className="dash-panel-h">Top offender</div>
          <div className="causes-offender-panel">
            <div>
              <div className="causes-offender-label">Policy</div>
              <div className="causes-offender-policy-value">{topPair.policy_name}</div>
            </div>
            <div>
              <div className="causes-offender-label">Agent</div>
              <div className="causes-offender-value">{topPair.agent}</div>
            </div>
            <div>
              <div className="causes-offender-label">Blocks</div>
              <div className="causes-offender-num">{topPair.block_count}</div>
            </div>
            <div>
              <div className="causes-offender-label">Block rate</div>
              <div className="causes-offender-rate" style={{ color: cellTextColor(topPair.block_rate) }}>
                {pct(topPair.block_rate)}
                {trendBadge(topPair.trend)}
              </div>
            </div>
            <div className="causes-offender-vs">
              vs prior {windowDays}d
            </div>
          </div>
        </div>
      )}

      {/* Heat-map (desktop) */}
      <div className="pca-heatmap">
        <div className="dash-panel-h causes-section-h">
          Block rate heat-map
          <span className="causes-legend">
            <span className="causes-legend-amber">■</span> 1–5%&nbsp;&nbsp;
            <span className="causes-legend-rose-dim">■</span> 5–20%&nbsp;&nbsp;
            <span className="causes-legend-rose">■</span> &gt;20%
          </span>
        </div>
        <HeatMapTable report={report} />
      </div>

      {/* Ranked list (mobile) */}
      <div className="pca-mobile">
        <div className="dash-panel-h causes-section-h">Policy × agent ranking</div>
        <MobileRankedList heat_map={report.heat_map} windowDays={windowDays} />
      </div>

      {/* By policy summary */}
      <div className="dash-panel-h causes-section-h">By policy</div>
      <div className="causes-by-policy-list">
        {report.by_policy.map((p) => (
          <div key={p.policy_name} className="causes-by-policy-row">
            <div>
              <div className="causes-by-policy-name">{p.policy_name}</div>
              <div className="causes-by-policy-worst">
                Worst: {p.worst_agent} · {pct(p.worst_rate)}
              </div>
            </div>
            <div className="causes-by-policy-agents">
              {p.affected_agents} agent{p.affected_agents !== 1 ? "s" : ""}
            </div>
            <div className="causes-by-policy-total">
              {p.total_blocks}
            </div>
            <div className="causes-by-policy-rate" style={{ color: cellTextColor(p.worst_rate) }}>
              {pct(p.worst_rate)}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="appc">
      <style>{`
        @media (max-width: 640px) {
          .pca-heatmap { display: none !important; }
          .pca-mobile  { display: block !important; }
        }
        @media (min-width: 641px) {
          .pca-mobile  { display: none !important; }
        }
      `}</style>

      <a href="/app/policies" className="apprun-back mono">← Policies</a>
      {/* Header */}
      <div className="appc-head causes-head">
        <div>
          <h1 className="appc-h1">Policy causal attribution</h1>
          <p className="appc-sub">Which policies are firing, against which agents, at what rate — and whether it&apos;s getting worse.</p>
        </div>
        <form method="get" className="causes-form">
          <select
            name="days"
            defaultValue={String(windowDays)}
            className="causes-select"
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
          <button type="submit" className="btn-line causes-btn-sm">Apply</button>
        </form>
      </div>
      <FeatureGate
        allowed={allowed}
        badge={planBadgeText("policy_causes")}
        title="See exactly which agents are tripping your policies"
        lead="The policy causes heat map shows block rate per policy × agent pair, trend vs. the prior window, and total block counts — so you can tell which agents need prompt changes and which policies need rule refinement. Available on Scale, Pro, and Enterprise."
      >
        {body}
      </FeatureGate>
    </div>
  );
}
