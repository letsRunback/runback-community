/**
 * Org-scoped fleet metrics for the control-room overview.
 *
 * Scale: the big aggregates (totals, the 14-day series, top agents, period-over-
 * period) are read from precomputed per-day/per-agent rollups — O(days), not
 * O(runs) — so the dashboard holds at 100M+ runs. The few things a rollup can't
 * hold (recent failures, in-flight count, p95) come from small, indexed, bounded
 * queries. Rollups are incremented at ingest and backfilled once per org.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { estCostUsd } from "@/lib/cost";

export interface OrgOverview {
  totalRuns: number;
  success: number;
  errors: number;
  running: number;
  errorRate: number; // 0..1 of completed runs
  totalTokens: number;
  estCostUsd: number; // blended estimate
  avgLatencyMs: number;
  p95LatencyMs: number;
  // period-over-period (last 7d vs prior 7d)
  runs7: number;
  runsPrev7: number;
  errRate7: number;
  errRatePrev7: number;
  days: { date: string; total: number; errors: number }[]; // last 14 days, oldest→newest
  recentFailures: { run_id: string; name: string; error: string; started_at: string | null }[];
  topAgents: { name: string; count: number; errorRate: number; tokens: number }[];
}

/** Light counts for the free-tier overview (no fleet analytics). */
export async function getOrgBasic(orgId: string): Promise<{ total: number; errors: number; success: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const head = async (status?: string) => {
    let q = sb.from("ad_runs").select("run_id", { count: "exact", head: true }).eq("org_id", orgId);
    if (status) q = q.eq("status", status);
    const { count } = await q;
    return count ?? 0;
  };
  const [total, errors, success] = await Promise.all([head(), head("error"), head("success")]);
  return { total, errors, success };
}

export async function getOrgOverview(orgId: string): Promise<OrgOverview> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  // Rollups make the heavy aggregates O(days). Backfill once if this org has none.
  const { count: rollupCount } = await sb
    .from("ad_run_rollups").select("org_id", { count: "exact", head: true }).eq("org_id", orgId);
  if (!rollupCount) {
    try { await sb.rpc("backfill_rollups", { p_org: orgId, p_since_days: 90 }); } catch { /* best-effort */ }
  }

  const since = new Date(Date.now() - 13 * 86400_000).toISOString().slice(0, 10);
  const { data: roll } = await sb
    .from("ad_run_rollups")
    .select("day,agent,runs,errors,success,tokens,latency_sum,latency_count")
    .eq("org_id", orgId)
    .gte("day", since);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = roll || [];

  const byDay = new Map<string, { total: number; errors: number }>();
  const byAgent = new Map<string, { count: number; errors: number; tokens: number }>();
  let totalRuns = 0, errors = 0, success = 0, totalTokens = 0, latSum = 0, latCnt = 0;
  let runs7 = 0, runsPrev7 = 0, err7 = 0, done7 = 0, errPrev7 = 0, donePrev7 = 0;
  const now = Date.now();

  for (const r of rows) {
    const runs = Number(r.runs), errs = Number(r.errors);
    totalRuns += runs; errors += errs; success += Number(r.success);
    totalTokens += Number(r.tokens); latSum += Number(r.latency_sum); latCnt += Number(r.latency_count);

    const d = byDay.get(r.day) || { total: 0, errors: 0 };
    d.total += runs; d.errors += errs; byDay.set(r.day, d);

    const a = byAgent.get(r.agent) || { count: 0, errors: 0, tokens: 0 };
    a.count += runs; a.errors += errs; a.tokens += Number(r.tokens); byAgent.set(r.agent, a);

    const ageDays = (now - new Date(r.day + "T00:00:00Z").getTime()) / 86400_000;
    if (ageDays < 7) { runs7 += runs; done7 += runs; err7 += errs; }
    else { runsPrev7 += runs; donePrev7 += runs; errPrev7 += errs; }
  }

  const days: OrgOverview["days"] = [];
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const v = byDay.get(dt) || { total: 0, errors: 0 };
    days.push({ date: dt, total: v.total, errors: v.errors });
  }

  const topAgents = [...byAgent.entries()]
    .map(([name, v]) => ({ name, count: v.count, errorRate: v.count ? v.errors / v.count : 0, tokens: v.tokens }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const avgLatencyMs = latCnt ? Math.round(latSum / latCnt) : 0;

  // Bounded, indexed queries for what rollups can't hold.
  const [runningRes, failsRes, sampleRes] = await Promise.all([
    sb.from("ad_runs").select("run_id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "running"),
    sb.from("ad_runs").select("run_id,name,error,started_at").eq("org_id", orgId).eq("status", "error").order("created_at", { ascending: false }).limit(6),
    sb.from("ad_runs").select("started_at,ended_at").eq("org_id", orgId).in("status", ["success", "error"]).order("created_at", { ascending: false }).limit(500),
  ]);

  const latencies: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (sampleRes.data || []) as any[]) {
    if (r.started_at && r.ended_at) {
      const ms = new Date(r.ended_at).getTime() - new Date(r.started_at).getTime();
      if (ms >= 0 && ms < 3600_000) latencies.push(ms);
    }
  }
  latencies.sort((a, b) => a - b);
  const p95LatencyMs = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentFailures: OrgOverview["recentFailures"] = ((failsRes.data || []) as any[]).map((r) => {
    const msg = r.error && typeof r.error === "object" ? (r.error.message || r.error.name || "error") : String(r.error || "error");
    return { run_id: r.run_id, name: r.name || "agent", error: String(msg).slice(0, 120), started_at: r.started_at };
  });

  const completed = success + errors;
  return {
    totalRuns,
    success, errors, running: runningRes.count ?? 0,
    errorRate: completed ? errors / completed : 0,
    totalTokens,
    estCostUsd: estCostUsd(totalTokens),
    avgLatencyMs, p95LatencyMs,
    runs7, runsPrev7,
    errRate7: done7 ? err7 / done7 : 0,
    errRatePrev7: donePrev7 ? errPrev7 / donePrev7 : 0,
    days, recentFailures, topAgents,
  };
}
