/**
 * Chargeback / Internal Billing — per-team AI cost breakdown with budget caps.
 * Teams are named sub-units within an org. Runs are tagged to them (directly via
 * team_id, or via agent prefix rules). A daily cron rolls up cost per team per day.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { tryRead } from "@/lib/supabase/read";
import { PRICING } from "@/lib/costAttr";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so the read is capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

/**
 * Blended $/1M-token rate per model — derived, not restated.
 *
 * This used to be its own hand-maintained table, and it had already drifted from
 * the per-model rates in costAttr.ts: gpt-4o was priced here at $10.00/1M with a
 * comment reading "$5 input + $15 output", while costAttr had the current
 * $2.50 / $10.00. The same run therefore cost roughly 1.8× more on the
 * per-team chargeback page than on cost attribution, and the model key sets had
 * diverged too (claude-3-5-sonnet here vs claude-sonnet-4-6 there).
 *
 * costAttr.PRICING is now the single source of per-model pricing; this blends it
 * at the documented 60/40 input/output split. Update prices in one place.
 *
 * Note this is deliberately NOT the same thing as cost.ts's BLENDED_USD_PER_TOKEN,
 * which is one flat mixed-model estimate shared by the dashboard and the alert
 * engine so a displayed spend and the threshold it alerts on can never disagree.
 * That one is intentionally model-blind.
 */
const INPUT_SHARE = 0.6;
const DEFAULT_BLENDED_USD_PER_M = 5.0; // unknown models

function blendedRateUsdPerM(modelId: string | null): number {
  if (!modelId) return DEFAULT_BLENDED_USD_PER_M;
  const p = PRICING[modelId];
  if (!p) return DEFAULT_BLENDED_USD_PER_M;
  return p.input * INPUT_SHARE + p.output * (1 - INPUT_SHARE);
}

export function tokenCostUsd(tokens: number, modelId: string | null): number {
  return (tokens / 1_000_000) * blendedRateUsdPerM(modelId);
}

export interface Team {
  id: string;
  name: string;
  budget_usd: number | null;
  color: string | null;
}

export interface TeamCostRow {
  team: Team;
  cost_usd: number;
  tokens: number;
  runs: number;
  pct_of_total: number;
  budget_usd: number | null;
  /** cost_usd / (budget_usd / 12 * windowDays / 30) — prorated monthly budget */
  budget_utilization: number | null;
  budget_status: "ok" | "warning" | "over"; // ok <80%, warning 80-100%, over >100%
  cost_per_run: number;
  primary_agents: string[]; // top 3 agents by run count
}

export interface ChargebackReport {
  window_days: number;
  total_cost_usd: number;
  total_tokens: number;
  total_runs: number;
  by_team: TeamCostRow[];
  untagged_cost_usd: number;
  generated_at: string;
}

export async function getChargebackReport(orgId: string, windowDays: number): Promise<ChargebackReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString().slice(0, 10);

  // 1. Fetch all teams for org
  const { data: teamsData } = await sb
    .from("ad_teams")
    .select("id,name,budget_usd,color")
    .eq("org_id", orgId);

  const teams: Team[] = (teamsData ?? []).map((t: { id: string; name: string; budget_usd: number | null; color: string | null }) => ({
    id: t.id,
    name: t.name,
    budget_usd: t.budget_usd,
    color: t.color,
  }));

  // 2. Fetch chargeback rollup for window
  const { data: cbRows } = await sb
    .from("ad_chargeback")
    .select("team_id,day,runs,tokens,cost_usd")
    .eq("org_id", orgId)
    .gte("day", since);

  // 3. Fetch top agents per team from ad_runs (last windowDays).
  //    The agent name is `name` — there is no `agent` column, and asking for one
  //    made this query 400 so primary_agents was always empty on every team card.
  const agentRows = await tryRead<Array<{ team_id: string | null; name: string | null }>>(
    sb
      .from("ad_runs")
      .select("team_id,name")
      .eq("org_id", orgId)
      .gte("started_at", new Date(Date.now() - windowDays * 86400_000).toISOString())
      .not("team_id", "is", null)
        .limit(MAX_ROWS),
    "chargeback report: load per-team agent names",
    []
  );

  // Build agent counts per team
  const teamAgentCounts = new Map<string, Map<string, number>>();
  for (const row of agentRows) {
    if (!row.team_id || !row.name) continue;
    const agentMap = teamAgentCounts.get(row.team_id) ?? new Map<string, number>();
    agentMap.set(row.name, (agentMap.get(row.name) ?? 0) + 1);
    teamAgentCounts.set(row.team_id, agentMap);
  }

  // Aggregate chargeback by team
  const teamStats = new Map<string, { cost_usd: number; tokens: number; runs: number }>();
  let totalCost = 0;
  let totalTokens = 0;
  let totalRuns = 0;

  for (const row of cbRows ?? []) {
    const s = teamStats.get(row.team_id) ?? { cost_usd: 0, tokens: 0, runs: 0 };
    s.cost_usd += Number(row.cost_usd);
    s.tokens += Number(row.tokens);
    s.runs += Number(row.runs);
    teamStats.set(row.team_id, s);
    totalCost += Number(row.cost_usd);
    totalTokens += Number(row.tokens);
    totalRuns += Number(row.runs);
  }

  // 4. Estimate untagged cost from ad_run_rollups (runs without team attribution)
  const { data: rollupRows } = await sb
    .from("ad_run_rollups")
    .select("tokens")
    .eq("org_id", orgId)
    .gte("day", since);

  const totalRollupTokens = (rollupRows ?? []).reduce((sum: number, r: { tokens: number }) => sum + Number(r.tokens), 0);
  const taggedTokens = [...teamStats.values()].reduce((sum, s) => sum + s.tokens, 0);
  const untaggedTokens = Math.max(0, totalRollupTokens - taggedTokens);
  const untaggedCostUsd = tokenCostUsd(untaggedTokens, null);

  // Build by_team
  const by_team: TeamCostRow[] = [];
  for (const team of teams) {
    const s = teamStats.get(team.id) ?? { cost_usd: 0, tokens: 0, runs: 0 };
    const agentMap = teamAgentCounts.get(team.id);
    const primaryAgents = agentMap
      ? [...agentMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)
      : [];

    // Prorated monthly budget for the window
    let budgetUtilization: number | null = null;
    let budgetStatus: "ok" | "warning" | "over" = "ok";
    if (team.budget_usd != null && team.budget_usd > 0) {
      const proratedBudget = (team.budget_usd / 12) * (windowDays / 30);
      budgetUtilization = s.cost_usd / proratedBudget;
      budgetStatus = budgetUtilization >= 1 ? "over" : budgetUtilization >= 0.8 ? "warning" : "ok";
    }

    by_team.push({
      team,
      cost_usd: s.cost_usd,
      tokens: s.tokens,
      runs: s.runs,
      pct_of_total: totalCost > 0 ? s.cost_usd / totalCost : 0,
      budget_usd: team.budget_usd,
      budget_utilization: budgetUtilization,
      budget_status: budgetStatus,
      cost_per_run: s.runs > 0 ? s.cost_usd / s.runs : 0,
      primary_agents: primaryAgents,
    });
  }

  by_team.sort((a, b) => b.cost_usd - a.cost_usd);

  return {
    window_days: windowDays,
    total_cost_usd: totalCost,
    total_tokens: totalTokens,
    total_runs: totalRuns,
    by_team,
    untagged_cost_usd: untaggedCostUsd,
    generated_at: new Date().toISOString(),
  };
}

export async function getTeams(orgId: string): Promise<Team[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb
    .from("ad_teams")
    .select("id,name,budget_usd,color")
    .eq("org_id", orgId)
    .order("name");
  return (data ?? []).map((t: { id: string; name: string; budget_usd: number | null; color: string | null }) => ({
    id: t.id, name: t.name, budget_usd: t.budget_usd, color: t.color,
  }));
}

export async function createTeam(orgId: string, name: string, budgetUsd: number | null, color: string | null): Promise<Team> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data, error } = await sb
    .from("ad_teams")
    .insert({ org_id: orgId, name, budget_usd: budgetUsd, color })
    .select("id,name,budget_usd,color")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name, budget_usd: data.budget_usd, color: data.color };
}

export async function updateTeamBudget(orgId: string, teamId: string, budgetUsd: number | null): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { error } = await sb
    .from("ad_teams")
    .update({ budget_usd: budgetUsd })
    .eq("id", teamId)
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
}

export async function deleteTeam(orgId: string, teamId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { error } = await sb
    .from("ad_teams")
    .delete()
    .eq("id", teamId)
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
}

export async function getAgentRules(orgId: string): Promise<Array<{ id: string; team_id: string; prefix: string }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb
    .from("ad_team_agent_rules")
    .select("id,team_id,prefix")
    .eq("org_id", orgId)
    .order("prefix");
  return (data ?? []).map((r: { id: string; team_id: string; prefix: string }) => ({
    id: r.id, team_id: r.team_id, prefix: r.prefix,
  }));
}

export async function upsertAgentRule(orgId: string, teamId: string, prefix: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { error } = await sb
    .from("ad_team_agent_rules")
    .upsert({ org_id: orgId, team_id: teamId, prefix: prefix.toLowerCase() }, { onConflict: "org_id,prefix" });
  if (error) throw new Error(error.message);
}

export async function deleteAgentRule(orgId: string, ruleId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { error } = await sb
    .from("ad_team_agent_rules")
    .delete()
    .eq("id", ruleId)
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
}
