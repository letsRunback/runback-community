/**
 * Policy causal attribution — answers "which policies are firing, against
 * which agents, and at what rate?" Aggregates ad_policy_causes rollup table
 * and computes trend vs. prior window for heat-map and top-offender cards.
 */
import { getAdminClient } from "@/lib/supabase/admin";

export interface PolicyCauseStat {
  policy_name: string;
  agent: string;
  block_count: number;
  run_count: number;
  block_rate: number; // block_count / run_count (0 if run_count == 0)
  trend: number; // % change vs prior windowDays (positive = worse)
}

export interface PolicyCausesReport {
  window_days: number;
  total_blocks: number;
  unique_policies: number;
  agents_with_high_block_rate: number; // block_rate > 0.05
  by_policy: Array<{
    policy_name: string;
    total_blocks: number;
    affected_agents: number;
    worst_agent: string;
    worst_rate: number;
  }>;
  heat_map: PolicyCauseStat[]; // all policy x agent combos with >0 blocks
  top_pair: PolicyCauseStat | null; // highest blast radius (block_count)
}

interface RawRow {
  org_id: string;
  day: string;
  policy_name: string;
  agent: string;
  block_count: number;
  run_count: number;
}

function buildStats(rows: RawRow[], priorRows: RawRow[]): PolicyCauseStat[] {
  // Group current by policy+agent
  const cur = new Map<string, { block_count: number; run_count: number }>();
  for (const r of rows) {
    const k = `${r.policy_name}|${r.agent}`;
    const s = cur.get(k) ?? { block_count: 0, run_count: 0 };
    s.block_count += r.block_count;
    s.run_count += r.run_count;
    cur.set(k, s);
  }

  // Group prior by policy+agent
  const prior = new Map<string, { block_count: number; run_count: number }>();
  for (const r of priorRows) {
    const k = `${r.policy_name}|${r.agent}`;
    const s = prior.get(k) ?? { block_count: 0, run_count: 0 };
    s.block_count += r.block_count;
    s.run_count += r.run_count;
    prior.set(k, s);
  }

  const stats: PolicyCauseStat[] = [];
  for (const [k, c] of cur.entries()) {
    const [policy_name, agent] = k.split("|");
    const block_rate = c.run_count > 0 ? c.block_count / c.run_count : 0;
    const p = prior.get(k);
    const prior_rate = p && p.run_count > 0 ? p.block_count / p.run_count : 0;
    const trend = prior_rate > 0 ? (block_rate - prior_rate) / prior_rate : block_rate > 0 ? 1 : 0;
    stats.push({ policy_name, agent, block_count: c.block_count, run_count: c.run_count, block_rate, trend });
  }

  return stats.sort((a, b) => b.block_count - a.block_count);
}

export async function getPolicyCausesReport(orgId: string, windowDays = 30): Promise<PolicyCausesReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 86400_000).toISOString().slice(0, 10);
  const priorStart = new Date(now.getTime() - 2 * windowDays * 86400_000).toISOString().slice(0, 10);

  const [{ data: curRows }, { data: priorRows }] = await Promise.all([
    sb
      .from("ad_policy_causes")
      .select("org_id,day,policy_name,agent,block_count,run_count")
      .eq("org_id", orgId)
      .gte("day", windowStart),
    sb
      .from("ad_policy_causes")
      .select("org_id,day,policy_name,agent,block_count,run_count")
      .eq("org_id", orgId)
      .gte("day", priorStart)
      .lt("day", windowStart),
  ]);

  const heat_map = buildStats(curRows ?? [], priorRows ?? []);

  const total_blocks = heat_map.reduce((sum, s) => sum + s.block_count, 0);
  const unique_policies = new Set(heat_map.map((s) => s.policy_name)).size;
  const agents_with_high_block_rate = new Set(
    heat_map.filter((s) => s.block_rate > 0.05).map((s) => s.agent)
  ).size;

  // by_policy grouping
  const policyMap = new Map<string, { total_blocks: number; agents: Map<string, number> }>();
  for (const s of heat_map) {
    const p = policyMap.get(s.policy_name) ?? { total_blocks: 0, agents: new Map() };
    p.total_blocks += s.block_count;
    p.agents.set(s.agent, (p.agents.get(s.agent) ?? 0) + s.block_count);
    policyMap.set(s.policy_name, p);
  }

  const by_policy = [...policyMap.entries()].map(([policy_name, p]) => {
    const agentEntries = [...p.agents.entries()].sort((a, b) => b[1] - a[1]);
    const worst_agent = agentEntries[0]?.[0] ?? "";
    const worstStat = heat_map.find((s) => s.policy_name === policy_name && s.agent === worst_agent);
    return {
      policy_name,
      total_blocks: p.total_blocks,
      affected_agents: p.agents.size,
      worst_agent,
      worst_rate: worstStat?.block_rate ?? 0,
    };
  }).sort((a, b) => b.total_blocks - a.total_blocks);

  const top_pair = heat_map[0] ?? null;

  return {
    window_days: windowDays,
    total_blocks,
    unique_policies,
    agents_with_high_block_rate,
    by_policy,
    heat_map,
    top_pair,
  };
}
