/**
 * Agent cost attribution — full cost breakdown by model and agent class,
 * with concrete optimization recommendations. Turns Runback from an audit
 * tool into a cost-optimization engine.
 *
 * Pricing table is an approximation for demo purposes; production deployments
 * should fetch live prices from provider APIs.
 */
import { getAdminClient } from "@/lib/supabase/admin";

// $/1M tokens (input, output) as of mid-2026 — update as needed
export const PRICING: Record<string, { input: number; output: number; name: string }> = {
  "gpt-4o":                { input: 2.50,  output: 10.00, name: "GPT-4o" },
  "gpt-4o-mini":           { input: 0.15,  output: 0.60,  name: "GPT-4o mini" },
  "gpt-4-turbo":           { input: 10.00, output: 30.00, name: "GPT-4 Turbo" },
  "gpt-3.5-turbo":         { input: 0.50,  output: 1.50,  name: "GPT-3.5 Turbo" },
  "claude-sonnet-4-6":     { input: 3.00,  output: 15.00, name: "Claude Sonnet 4.6" },
  "claude-haiku-4-5":      { input: 0.80,  output: 4.00,  name: "Claude Haiku 4.5" },
  "claude-opus-4-8":       { input: 15.00, output: 75.00, name: "Claude Opus 4.8" },
  "claude-3-5-sonnet":     { input: 3.00,  output: 15.00, name: "Claude 3.5 Sonnet" },
  "claude-3-5-haiku":      { input: 0.80,  output: 4.00,  name: "Claude 3.5 Haiku" },
  "claude-3-opus":         { input: 15.00, output: 75.00, name: "Claude 3 Opus" },
  "gemini-1.5-pro":        { input: 3.50,  output: 10.50, name: "Gemini 1.5 Pro" },
  "gemini-1.5-flash":      { input: 0.35,  output: 1.05,  name: "Gemini 1.5 Flash" },
  "gemini-2.0-flash":      { input: 0.10,  output: 0.40,  name: "Gemini 2.0 Flash" },
};

// Assume ~60/40 input/output split as a reasonable default
const INPUT_RATIO = 0.6;

export function estimateCost(totalTokens: number, modelId: string): number {
  const pricing = PRICING[modelId];
  if (!pricing) return 0;
  const inputTokens  = totalTokens * INPUT_RATIO;
  const outputTokens = totalTokens * (1 - INPUT_RATIO);
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export interface ModelCostRow {
  model_id: string;
  model_name: string;
  runs: number;
  total_tokens: number;
  cost_usd: number;
  cost_per_run: number;
  error_rate: number;
  pct_of_total: number;
}

export interface CostOptimization {
  current_model: string;
  current_model_name: string;
  recommended_model: string;
  recommended_model_name: string;
  current_monthly_usd: number;
  projected_monthly_usd: number;
  savings_usd: number;
  savings_pct: number;
  caveat: string;
}

export interface AgentCostRow {
  agent_name: string;
  runs: number;
  total_tokens: number;
  cost_usd: number;
  primary_model: string;
}

export interface CostAttributionReport {
  window_days: number;
  total_cost_usd: number;
  total_tokens: number;
  total_runs: number;
  by_model: ModelCostRow[];
  by_agent: AgentCostRow[];
  optimizations: CostOptimization[];
  generated_at: string;
}

export async function getCostAttribution(orgId: string, windowDays = 30): Promise<CostAttributionReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  // Aggregated in the database.
  //
  // This block fetched every completed run in the window and then looked up
  // model usage for runIds.slice(0, 500), so total_runs covered the window
  // while the per-model and per-agent cost teams are billed from covered at
  // most five hundred runs. Measured on 1,200 runs: 500 covered, 50,000 tokens
  // counted against 120,000 actual. Internally inconsistent, and silent.
  const { data: rows, error: sumErr } = await sb.rpc("cost_summary", { p_org: orgId, p_since: since });
  if (sumErr) throw new Error(`Could not compute cost attribution: ${sumErr.message}`);

  const summary = (rows ?? []) as {
    agent_name: string; model_id: string; runs: number; tokens: number; errors: number;
  }[];
  if (!summary.length) {
    return { window_days: windowDays, total_cost_usd: 0, total_tokens: 0, total_runs: 0, by_model: [], by_agent: [], optimizations: [], generated_at: new Date().toISOString() };
  }

  // Roll the (agent, model) grid up each way.
  const modelStats = new Map<string, { runs: number; tokens: number; errors: number }>();
  const agentMap = new Map<string, { runs: number; tokens: number; models: Map<string, number> }>();
  for (const r of summary) {
    const m = modelStats.get(r.model_id) ?? { runs: 0, tokens: 0, errors: 0 };
    m.runs += Number(r.runs); m.tokens += Number(r.tokens); m.errors += Number(r.errors);
    modelStats.set(r.model_id, m);

    const a = agentMap.get(r.agent_name) ?? { runs: 0, tokens: 0, models: new Map<string, number>() };
    a.runs += Number(r.runs); a.tokens += Number(r.tokens);
    a.models.set(r.model_id, (a.models.get(r.model_id) ?? 0) + Number(r.runs));
    agentMap.set(r.agent_name, a);
  }

  // Build by_model
  const by_model: ModelCostRow[] = [];
  let totalCost = 0, totalTokens = 0, totalRuns = 0;

  for (const [modelId, stats] of modelStats) {
    const cost = estimateCost(stats.tokens, modelId);
    totalCost += cost;
    totalTokens += stats.tokens;
    totalRuns += stats.runs;
    by_model.push({
      model_id: modelId,
      model_name: PRICING[modelId]?.name ?? modelId,
      runs: stats.runs,
      total_tokens: stats.tokens,
      cost_usd: cost,
      cost_per_run: stats.runs > 0 ? cost / stats.runs : 0,
      error_rate: stats.runs > 0 ? stats.errors / stats.runs : 0,
      pct_of_total: 0, // filled below
    });
  }

  for (const row of by_model) {
    row.pct_of_total = totalCost > 0 ? row.cost_usd / totalCost : 0;
  }
  by_model.sort((a, b) => b.cost_usd - a.cost_usd);

  // by_agent comes from the same aggregate — see the roll-up above.
  const by_agent: AgentCostRow[] = [...agentMap.entries()].map(([name, s]) => {
    const primaryModel = [...s.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
    return {
      agent_name: name,
      runs: s.runs,
      total_tokens: s.tokens,
      cost_usd: estimateCost(s.tokens, primaryModel),
      primary_model: PRICING[primaryModel]?.name ?? primaryModel,
    };
  }).sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 10);

  // Optimizations: for each expensive model, suggest a cheaper alternative
  const optimizations: CostOptimization[] = [];
  const SUBSTITUTES: Record<string, string> = {
    "gpt-4o":        "gpt-4o-mini",
    "gpt-4-turbo":   "gpt-4o",
    "claude-3-opus": "claude-3-5-sonnet",
    "claude-opus-4-8": "claude-sonnet-4-6",
    "gemini-1.5-pro": "gemini-1.5-flash",
  };

  for (const row of by_model.slice(0, 3)) {
    const sub = SUBSTITUTES[row.model_id];
    if (!sub || !PRICING[sub]) continue;
    const projectedCost = estimateCost(row.total_tokens, sub);
    const savings = row.cost_usd - projectedCost;
    if (savings < 0.01) continue;
    const monthly = windowDays > 0 ? (row.cost_usd / windowDays) * 30 : row.cost_usd;
    const projMonthly = windowDays > 0 ? (projectedCost / windowDays) * 30 : projectedCost;
    optimizations.push({
      current_model: row.model_id,
      current_model_name: row.model_name,
      recommended_model: sub,
      recommended_model_name: PRICING[sub].name,
      current_monthly_usd: monthly,
      projected_monthly_usd: projMonthly,
      savings_usd: monthly - projMonthly,
      savings_pct: monthly > 0 ? (monthly - projMonthly) / monthly : 0,
      caveat: "Use the Model Diff tool to verify quality parity before switching.",
    });
  }

  const report: CostAttributionReport = {
    window_days: windowDays,
    total_cost_usd: totalCost,
    total_tokens: totalTokens,
    total_runs: totalRuns,
    by_model,
    by_agent,
    optimizations,
    generated_at: new Date().toISOString(),
  };

  // Cache
  await sb.from("ad_cost_cache").upsert({ org_id: orgId, window_days: windowDays, report, generated_at: report.generated_at }, { onConflict: "org_id,window_days" });

  return report;
}
