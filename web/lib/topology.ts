/**
 * Fleet topology — aggregate view across all multi-agent orchestrations for an org.
 *
 * A "topology run" is any run that either:
 *   (a) has children  →  orchestrator
 *   (b) has a parent  →  subagent
 *
 * We fetch the window's worth of runs in two queries (roots + all their children),
 * then aggregate entirely in JS — no raw SQL needed beyond simple selects.
 */
import { getAdminClient } from "@/lib/supabase/admin";

export interface AgentRoleStat {
  name: string;
  as_orchestrator: number;      // times this agent name was the root
  as_subagent: number;          // times called as a child
  avg_tokens: number;
  p50_duration_ms: number;
  p90_duration_ms: number;
  error_rate: number;
  total_tokens: number;
  is_bottleneck: boolean;       // highest avg subagent duration
}

export interface RecentOrchestration {
  run_id: string;
  name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  total_tokens: number;
  child_count: number;
  max_depth: number;
  is_parallel: boolean;         // any children overlapping in time
}

export interface TopologyReport {
  window_days: number;
  total_orchestrations: number;
  total_agent_invocations: number;  // all runs that participated (roots + children)
  avg_tree_depth: number;
  avg_fanout: number;               // avg direct children per orchestrator
  total_tokens_across_trees: number;
  parallel_pct: number;             // % of orchestrations that used parallel subagents
  agent_stats: AgentRoleStat[];
  recent_orchestrations: RecentOrchestration[];
}

function pctile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function durMs(r: { started_at: string | null; ended_at: string | null }): number | null {
  if (!r.started_at || !r.ended_at) return null;
  return new Date(r.ended_at).getTime() - new Date(r.started_at).getTime();
}

export async function getTopologyReport(orgId: string, windowDays = 30): Promise<TopologyReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  // 1. Fetch all runs in window — we need parent_run_id to determine topology.
  const { data: runs } = await sb
    .from("ad_runs")
    .select("run_id,name,status,started_at,ended_at,total_tokens,step_count,parent_run_id")
    .eq("org_id", orgId)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(2000);

  if (!runs?.length) {
    return {
      window_days: windowDays, total_orchestrations: 0,
      total_agent_invocations: 0, avg_tree_depth: 0, avg_fanout: 0,
      total_tokens_across_trees: 0, parallel_pct: 0,
      agent_stats: [], recent_orchestrations: [],
    };
  }

   
  type Run = { run_id: string; name: string; status: string; started_at: string | null; ended_at: string | null; total_tokens: number; parent_run_id: string | null };
  const allRuns = runs as Run[];

  // Build lookup maps
  const childrenOf = new Map<string, Run[]>();
  for (const r of allRuns) {
    if (r.parent_run_id) {
      if (!childrenOf.has(r.parent_run_id)) childrenOf.set(r.parent_run_id, []);
      childrenOf.get(r.parent_run_id)!.push(r);
    }
  }

  // Orchestrators = runs that have at least one child in our dataset
  const orchestratorIds = new Set<string>(
    allRuns.filter(r => childrenOf.has(r.run_id)).map(r => r.run_id)
  );
  // Subagents = runs that have a parent (in our dataset OR referenced externally)
  const subagentIds = new Set<string>(
    allRuns.filter(r => r.parent_run_id !== null).map(r => r.run_id)
  );

  if (!orchestratorIds.size) {
    return {
      window_days: windowDays, total_orchestrations: 0,
      total_agent_invocations: 0, avg_tree_depth: 0, avg_fanout: 0,
      total_tokens_across_trees: 0, parallel_pct: 0,
      agent_stats: [], recent_orchestrations: [],
    };
  }

  // ── Compute max depth per orchestrator (BFS) ─────────────────────────────
  function maxDepthOf(rootId: string): number {
    let depth = 0;
    let frontier = [rootId];
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const c of childrenOf.get(id) ?? []) next.push(c.run_id);
      }
      if (next.length) depth++;
      frontier = next;
    }
    return depth;
  }

  // ── Detect parallel execution (any two direct children overlap in time) ──
  function isParallel(rootId: string): boolean {
    const children = childrenOf.get(rootId) ?? [];
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const a = children[i], b = children[j];
        if (!a.started_at || !b.started_at || !a.ended_at || !b.ended_at) continue;
        const aStart = new Date(a.started_at).getTime(), aEnd = new Date(a.ended_at).getTime();
        const bStart = new Date(b.started_at).getTime(), bEnd = new Date(b.ended_at).getTime();
        if (aStart < bEnd && bStart < aEnd) return true;
      }
    }
    return false;
  }

  // ── Recent orchestrations ─────────────────────────────────────────────────
  const orchestratorRuns = allRuns.filter(r => orchestratorIds.has(r.run_id));
  const recentOrchestrations: RecentOrchestration[] = orchestratorRuns.slice(0, 20).map(r => ({
    run_id: r.run_id,
    name: r.name ?? "agent",
    status: r.status ?? "unknown",
    started_at: r.started_at ?? "",
    ended_at: r.ended_at,
    duration_ms: durMs(r),
    total_tokens: allRuns
      .filter(x => x.run_id === r.run_id || x.parent_run_id === r.run_id)
      .reduce((s, x) => s + (x.total_tokens ?? 0), 0),
    child_count: childrenOf.get(r.run_id)?.length ?? 0,
    max_depth: maxDepthOf(r.run_id),
    is_parallel: isParallel(r.run_id),
  }));

  // ── Agent role stats ──────────────────────────────────────────────────────
  const agentMap = new Map<string, {
    as_orchestrator: number; as_subagent: number;
    tokens: number[]; durations: number[]; errors: number; total: number;
  }>();

  for (const r of allRuns) {
    const isOrch = orchestratorIds.has(r.run_id);
    const isSub  = subagentIds.has(r.run_id);
    if (!isOrch && !isSub) continue;

    const name = r.name ?? "agent";
    if (!agentMap.has(name)) agentMap.set(name, { as_orchestrator: 0, as_subagent: 0, tokens: [], durations: [], errors: 0, total: 0 });
    const s = agentMap.get(name)!;
    if (isOrch) s.as_orchestrator++;
    if (isSub)  s.as_subagent++;
    s.tokens.push(r.total_tokens ?? 0);
    s.total++;
    if (r.status === "error") s.errors++;
    const d = durMs(r);
    if (d !== null) s.durations.push(d);
  }

  const agentStats: AgentRoleStat[] = [...agentMap.entries()].map(([name, s]) => {
    const sortedDur = [...s.durations].sort((a, b) => a - b);
    return {
      name,
      as_orchestrator: s.as_orchestrator,
      as_subagent: s.as_subagent,
      avg_tokens: s.tokens.length ? Math.round(s.tokens.reduce((a, b) => a + b, 0) / s.tokens.length) : 0,
      p50_duration_ms: pctile(sortedDur, 50),
      p90_duration_ms: pctile(sortedDur, 90),
      error_rate: s.total > 0 ? s.errors / s.total : 0,
      total_tokens: s.tokens.reduce((a, b) => a + b, 0),
      is_bottleneck: false,
    };
  }).sort((a, b) => b.total_tokens - a.total_tokens);

  // Mark bottleneck: highest p90 latency among pure subagents
  const subOnlyStats = agentStats.filter(s => s.as_subagent > 0);
  if (subOnlyStats.length) {
    const max = Math.max(...subOnlyStats.map(s => s.p90_duration_ms));
    for (const s of agentStats) { if (s.p90_duration_ms === max && s.as_subagent > 0) s.is_bottleneck = true; }
  }

  // ── Summary metrics ───────────────────────────────────────────────────────
  const allFanouts = [...orchestratorIds].map(id => childrenOf.get(id)?.length ?? 0);
  const allDepths  = [...orchestratorIds].map(id => maxDepthOf(id));
  const avgFanout  = allFanouts.length ? allFanouts.reduce((a, b) => a + b, 0) / allFanouts.length : 0;
  const avgDepth   = allDepths.length  ? allDepths.reduce((a, b) => a + b, 0)  / allDepths.length  : 0;
  const parallelCount = [...orchestratorIds].filter(id => isParallel(id)).length;

  return {
    window_days: windowDays,
    total_orchestrations: orchestratorIds.size,
    total_agent_invocations: orchestratorIds.size + subagentIds.size,
    avg_tree_depth: parseFloat(avgDepth.toFixed(1)),
    avg_fanout: parseFloat(avgFanout.toFixed(1)),
    total_tokens_across_trees: agentStats.reduce((s, a) => s + a.total_tokens, 0),
    parallel_pct: orchestratorIds.size ? Math.round((parallelCount / orchestratorIds.size) * 100) : 0,
    agent_stats: agentStats,
    recent_orchestrations: recentOrchestrations,
  };
}
