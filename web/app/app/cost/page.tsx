import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { getCostAttribution, type CostAttributionReport } from "@/lib/costAttr";
import { getChargebackReport, type ChargebackReport } from "@/lib/chargeback";
import { getVerifiedReplayCost, type VerifiedReplayCost } from "@/lib/verifiedCost";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { planBadgeText } from "@/lib/plans";
import { HBar } from "@/components/app/charts";
import GateOverlay from "../GateOverlay";
import { PRICING_HREF, UPGRADE_HREF } from "@/lib/edition";

const BUDGET_COLOR: Record<string, string> = { ok: "var(--emerald)", warning: "var(--amber)", over: "var(--rose)" };

export const dynamic = "force-dynamic";

export const DEMO_CHARGEBACK: ChargebackReport = {
  window_days: 30,
  total_cost_usd: 84.32,
  total_tokens: 9_200_000,
  total_runs: 1847,
  by_team: [
    { team: { id: "t1", name: "Lending",      budget_usd: 500, color: "#4f9cf9" }, cost_usd: 35.50, tokens: 3_800_000, runs: 802, pct_of_total: 0.421, budget_usd: 500, budget_utilization: 0.71,  budget_status: "ok",      cost_per_run: 0.0443, primary_agents: ["loan-approval-agent", "kyc-orchestrator"] },
    { team: { id: "t2", name: "Risk & Fraud", budget_usd: 300, color: "#a78bfa" }, cost_usd: 28.42, tokens: 2_900_000, runs: 620, pct_of_total: 0.337, budget_usd: 300, budget_utilization: 0.947, budget_status: "warning", cost_per_run: 0.0458, primary_agents: ["fraud-detection"] },
    { team: { id: "t3", name: "Reporting",    budget_usd: 150, color: "#34d399" }, cost_usd: 9.00,  tokens: 1_000_000, runs: 211, pct_of_total: 0.107, budget_usd: 150, budget_utilization: 0.60,  budget_status: "ok",      cost_per_run: 0.0427, primary_agents: ["report-generator"] },
    { team: { id: "t4", name: "Data Ops",     budget_usd: 100, color: "#f59e0b" }, cost_usd: 9.27,  tokens: 900_000,   runs: 214, pct_of_total: 0.110, budget_usd: 100, budget_utilization: 1.08,  budget_status: "over",    cost_per_run: 0.0433, primary_agents: ["data-extractor"] },
  ],
  untagged_cost_usd: 2.13,
  generated_at: new Date().toISOString(),
};

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what real cost attribution looks like, not an empty breakdown. GateOverlay
// only blurs its children with CSS, so this page must never pass a
// non-entitled org's own real spend/model/agent breakdown into it — that's
// exactly the paid-tier detail the gate exists to withhold.
const GLIMPSE_REPORT: CostAttributionReport = {
  window_days: 30,
  total_cost_usd: 84.32,
  total_tokens: 9_200_000,
  total_runs: 1847,
  by_model: [
    { model_id: "claude-sonnet-4-6", model_name: "Claude Sonnet 4.6", runs: 1102, total_tokens: 5_800_000, cost_usd: 52.10, cost_per_run: 0.0473, error_rate: 0.02, pct_of_total: 0.618 },
    { model_id: "gpt-4o-mini",       model_name: "GPT-4o mini",       runs: 745,  total_tokens: 3_400_000, cost_usd: 32.22, cost_per_run: 0.0432, error_rate: 0.05, pct_of_total: 0.382 },
  ],
  by_agent: [
    { agent_name: "loan-approval-agent", runs: 620, total_tokens: 3_200_000, cost_usd: 28.70, primary_model: "claude-sonnet-4-6" },
    { agent_name: "fraud-detection",     runs: 480, total_tokens: 2_600_000, cost_usd: 22.15, primary_model: "claude-sonnet-4-6" },
  ],
  optimizations: [
    { current_model: "gpt-4o", current_model_name: "GPT-4o", recommended_model: "gpt-4o-mini", recommended_model_name: "GPT-4o mini", current_monthly_usd: 210, projected_monthly_usd: 62, savings_usd: 148, savings_pct: 0.70, caveat: "Verify quality holds on your dataset before switching." },
  ],
  generated_at: new Date().toISOString(),
};
const GLIMPSE_VERIFIED: VerifiedReplayCost = {
  window_days: 30, total_cost_usd: 84.32, total_runs: 1847,
  verified_runs: 96, verified_cost_usd: 6.40, verified_pct: 0.076, cost_per_verified_run: 0.0667,
  generated_at: new Date().toISOString(),
};

/**
 * Model spend is genuinely USD — providers bill in it, and every figure here is
 * derived from BLENDED_USD_PER_TOKEN. Runback's own plans are billed in AUD.
 * Two real currencies on adjacent screens, so both get named: a bare "$" beside
 * an "A$49" plan price is exactly the ambiguity that makes a buyer distrust
 * both numbers.
 */
function usd(n: number) { return n < 0.01 ? "<US$0.01" : `US$${n.toFixed(2)}`; }
function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }
function tok(n: number) { return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n); }

const STATUS_LABELS: Record<string, string> = {
  ok: "On track",
  warning: "Near limit",
  over: "Over budget",
};

export default async function CostPage({ searchParams }: { searchParams: Promise<{ days?: string; tab?: string }> }) {
  const session = await requireSession();
  // Trial-aware effective plan — the raw orgs.plan column stays "free" for the
  // whole trial, which would deny a trialing org the features its trial grants.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  const allowed = demo || can(session.orgPlan, "cost_attribution");

  const { days, tab } = await searchParams;
  // `parseInt` on a non-numeric `days` (e.g. ?days=abc) returns NaN, and NaN
  // propagates through Math.max/Math.min unchanged — windowDays would stay
  // NaN, then `new Date(Date.now() - NaN).toISOString()` downstream throws
  // "Invalid time value" and 500s the whole page. `|| 30` catches the NaN
  // before it reaches the clamp, same guard app/compliance/page.tsx already uses.
  const windowDays = Math.min(90, Math.max(7, parseInt(days ?? "30", 10) || 30));
  const activeTab = tab === "team" ? "team" : "model";

  const hasTeamFeature = demo || can(session.orgPlan, "chargeback");
  const wantChargeback = activeTab === "team" && hasTeamFeature;

  // Always the org's OWN real numbers once entitled — never a disconnected
  // fictional total, which is exactly what made this page's numbers
  // contradict the Runs/Overview pages showing the same org. But GateOverlay
  // only blurs its children with CSS: they're fully present in the HTML, so a
  // non-entitled org must get the same illustrative fixture every other gated
  // page uses, not its own real breakdown recoverable via view-source. These
  // three reports are independent — fetch in parallel instead of three
  // serialized round trips.
  const [report, verified, chargebackReport] = allowed
    ? await Promise.all([
        getCostAttribution(session.orgId, windowDays),
        getVerifiedReplayCost(session.orgId, windowDays),
        wantChargeback ? getChargebackReport(session.orgId, windowDays) : Promise.resolve(null as ChargebackReport | null),
      ])
    : [GLIMPSE_REPORT, GLIMPSE_VERIFIED, wantChargeback ? DEMO_CHARGEBACK : null];

  const body = (
    <div className="appc">
      {/* Header */}
      <div className="cost-header appc-head">
        <div>
          <h1 className="appc-h1">Cost attribution</h1>
          <p className="cost-header-sub">Where your AI spend goes — by model and agent — with concrete savings recommendations.</p>
        </div>
        <form method="get" className="cost-filter-row">
          <input type="hidden" name="tab" value={activeTab} />
          <select name="days" defaultValue={String(windowDays)} className="cost-select">
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
          <button type="submit" className="btn-line" style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}>Apply</button>
        </form>
      </div>

      {/* KPI strip */}
      <div className="cost-kpis">
        {[
          { label: `Total cost (${windowDays}d)`, value: usd(report.total_cost_usd), sub: `${usd(report.total_cost_usd / windowDays * 30)}/mo est.` },
          { label: "Total tokens",                value: tok(report.total_tokens),   sub: report.total_runs > 0 ? `${tok(Math.round(report.total_tokens / report.total_runs))} avg/run` : "no runs yet" },
          { label: "Runs",                        value: String(report.total_runs),  sub: `${Math.round(report.total_runs / windowDays)}/day avg` },
          {
            label: "Verified via replay",
            value: verified.verified_runs > 0 && verified.verified_pct != null ? pct(verified.verified_pct) : "—",
            sub: verified.verified_runs > 0
              ? `${verified.verified_runs} run${verified.verified_runs === 1 ? "" : "s"} · ${usd(verified.verified_cost_usd)}`
              : "no gate runs yet",
          },
        ].map(({ label, value, sub }) => (
          <div key={label} className="cost-kpi">
            <div className="cost-kpi-label">{label}</div>
            <div className="cost-kpi-val">{value}</div>
            <div className="cost-kpi-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Tab strip */}
      <div className="cost-tabs">
        <Link href={`/app/cost?days=${windowDays}&tab=model`} className="cost-tab" data-active={activeTab === "model" ? "true" : undefined}>By model</Link>
        <Link href={`/app/cost?days=${windowDays}&tab=team`}  className="cost-tab" data-active={activeTab === "team"  ? "true" : undefined}>By team</Link>
        <Link href="/app/cost/teams" className="cost-tab cost-tab-right">Manage teams →</Link>
      </div>

      {/* ── Tab: By model ── */}
      {activeTab === "model" && (
        <>
          <div className="cost-section-h">Cost by model</div>
          {report.by_model.length === 0 && (
            <p className="empty cost-empty-row">No model spend in this window yet.</p>
          )}
          <div className="cost-model-list">
            {report.by_model.map((row) => (
              <div key={row.model_id} className="cost-model-row">
                <div>
                  <div className="cost-model-name">{row.model_name}</div>
                  <HBar
                    pct={row.pct_of_total * 100} color="var(--blue)" height={4}
                    label={row.model_name}
                    valueText={`${usd(row.cost_usd)} · ${pct(row.pct_of_total)} of total`}
                  />
                  <div className="cost-model-meta">
                    <span>{row.runs} runs</span>
                    <span>{tok(row.total_tokens)} tokens</span>
                    <span data-bad={row.error_rate > 0.1 ? "" : undefined}>{pct(row.error_rate)} errors</span>
                  </div>
                </div>
                <div className="cost-model-right">
                  <div className="cost-model-cost">{usd(row.cost_usd)}</div>
                  <div className="cost-model-per">{usd(row.cost_per_run)}/run</div>
                </div>
              </div>
            ))}
          </div>

          {report.optimizations.length > 0 && (
            <>
              <div className="cost-section-h">Optimization opportunities</div>
              {report.optimizations.map((opt) => (
                <div key={opt.current_model} className="cost-opt">
                  <div className="cost-opt-inner">
                    <div>
                      <div className="cost-opt-name">Switch {opt.current_model_name} → {opt.recommended_model_name}</div>
                      <div className="cost-opt-from">{usd(opt.current_monthly_usd)}/mo → {usd(opt.projected_monthly_usd)}/mo</div>
                      <div className="cost-opt-caveat">{opt.caveat}</div>
                    </div>
                    <div className="cost-opt-savings">
                      <div className="cost-opt-pct">−{pct(opt.savings_pct)}</div>
                      <div className="cost-opt-amt">{usd(opt.savings_usd)}/mo saved</div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="cost-section-h" style={{ marginTop: "0.25rem" }}>Top agents by cost</div>
          {report.by_agent.length === 0 ? (
            <p className="empty cost-empty-row">No agent spend in this window yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="appc-table">
                <thead>
                  <tr><th>Agent</th><th>Primary model</th><th className="num">Runs</th><th className="num">Tokens</th><th className="num">Cost</th></tr>
                </thead>
                <tbody>
                  {report.by_agent.map((a) => (
                    <tr key={a.agent_name}>
                      <td className="mono">{a.agent_name}</td>
                      <td className="mono appc-dim">{a.primary_model}</td>
                      <td className="mono num">{a.runs}</td>
                      <td className="mono num">{tok(a.total_tokens)}</td>
                      <td className="mono num">{usd(a.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Tab: By team ── */}
      {activeTab === "team" && (
        <>
          {!hasTeamFeature ? (
            <div className="cost-gate">
              <div className="cost-gate-title">Team chargeback is a Pro feature</div>
              <p className="cost-gate-body">Upgrade to track AI cost by department and set budget caps.</p>
              <Link href={PRICING_HREF} className="btn-fill" style={{ fontSize: "0.85rem" }}>See plans →</Link>
            </div>
          ) : !chargebackReport || chargebackReport.by_team.length === 0 ? (
            <div className="cost-gate">
              <div className="cost-gate-title">No teams configured</div>
              <p className="cost-gate-body">Set up teams to attribute AI cost by department.</p>
              <Link href="/app/cost/teams" className="btn-fill" style={{ fontSize: "0.85rem" }}>Set up teams →</Link>
            </div>
          ) : (
            <>
              <div className="cost-team-header-row">
                <div className="cost-section-h" style={{ margin: 0 }}>Cost by team</div>
                <a href={`/api/chargeback/export?days=${windowDays}`} className="cost-export-link">Export CSV</a>
              </div>
              <div className="cost-team-list">
                {chargebackReport.by_team.map((row) => (
                  <div key={row.team.id} className="cost-team-card">
                    <div className="cost-team-header">
                      <div className="cost-team-name">
                        <div className="cost-team-dot" style={{ background: row.team.color ?? "#4f9cf9" }} />
                        <span className="cost-team-label">{row.team.name}</span>
                        {row.budget_usd != null && (
                          <span className="cost-status-badge" data-status={row.budget_status}>
                            {STATUS_LABELS[row.budget_status]}
                          </span>
                        )}
                      </div>
                      <div className="cost-team-right">
                        <div className="cost-team-cost">{usd(row.cost_usd)}</div>
                        <div className="cost-team-pct">{pct(row.pct_of_total)} of total</div>
                      </div>
                    </div>

                    {row.budget_usd != null && row.budget_utilization != null ? (
                      <>
                        <HBar
                          pct={Math.min(100, row.budget_utilization * 100)} color={BUDGET_COLOR[row.budget_status] ?? "var(--emerald)"} height={3}
                          label={row.team.name}
                          valueText={`${usd(row.cost_usd)} of ${usd(row.budget_usd / 12 * row.budget_utilization)} prorated budget`}
                        />
                        <div className="cost-budget-note">
                          {usd(row.cost_usd)} of {usd(row.budget_usd / 12 * row.budget_utilization)} prorated budget
                        </div>
                      </>
                    ) : (
                      <>
                        <HBar
                          pct={row.pct_of_total * 100} color="var(--emerald)" height={3}
                          label={row.team.name}
                          valueText={`${usd(row.cost_usd)} · ${pct(row.pct_of_total)} of total, no budget cap`}
                        />
                        <div className="cost-budget-note">No budget cap set</div>
                      </>
                    )}

                    <div className="cost-team-footer">
                      <span>{row.runs} runs</span>
                      <span>{tok(row.tokens)} tokens</span>
                      <span>{usd(row.cost_per_run)}/run</span>
                      {row.primary_agents.length > 0 && (
                        <div className="cost-agents">
                          {row.primary_agents.map((ag) => (
                            <span key={ag} className="cost-agent-chip">{ag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {chargebackReport.untagged_cost_usd > 0 && (
                  <div className="cost-untagged">
                    <div className="cost-untagged-info">
                      <div className="cost-untagged-label">Untagged runs</div>
                      <div className="cost-untagged-detail">Not attributed to any team — set up agent rules to capture them.</div>
                    </div>
                    <div className="cost-untagged-val">{usd(chargebackReport.untagged_cost_usd)}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );

  if (!allowed) {
    return (
      <GateOverlay
        badge={`Cost attribution · ${planBadgeText("cost_attribution")}`}
        title="See exactly where your AI spend goes."
        lead="Cost broken down by model and agent, with concrete savings recommendations and verified replay cost. Your real numbers — shown here blurred until you upgrade."
        ctaHref={UPGRADE_HREF}
        ctaLabel="Upgrade →"
      >
        {body}
      </GateOverlay>
    );
  }

  return body;
}
