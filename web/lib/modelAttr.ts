/**
 * Model version attribution — mines ad_events.model_id across completed runs to
 * surface per-model reliability: error rate, latency, token cost. Gives fleet
 * owners the authoritative answer to "which model version caused regressions?"
 * Pro+ feature ("model_attribution"). Tenant-scoped: only queries this org.
 */
import { getAdminClient } from "@/lib/supabase/admin";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so reads are capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

export interface ModelStat {
  model_id: string;
  runs: number;
  errors: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalTokens: number;
  avgTokensPerRun: number;
  trend: "improving" | "degrading" | "stable";
}

export interface ModelAttributionReport {
  models: ModelStat[];
  windowDays: number;
  worstModel: string | null;
  bestModel: string | null;
}

export async function getModelAttribution(orgId: string, windowDays = 30): Promise<ModelAttributionReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const midpoint = new Date(Date.now() - (windowDays / 2) * 86400_000).toISOString();

  const { data: runs } = await sb
    .from("ad_runs")
    .select("run_id,status,started_at,ended_at,total_tokens,created_at")
    .eq("org_id", orgId)
    .in("status", ["success", "error"])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (!runs || runs.length === 0) return { models: [], windowDays, worstModel: null, bestModel: null };

  const runIds = (runs as { run_id: string }[]).map((r) => r.run_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runById = new Map((runs as any[]).map((r: any) => [r.run_id, r]));

  const { data: events } = await sb
    .from("ad_events")
    .select("run_id,model_id")
    .eq("org_id", orgId)
    .in("run_id", runIds)
    .eq("type", "llm")
    .not("model_id", "is", null).limit(MAX_ROWS);

  const modelRuns = new Map<string, Set<string>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ev of (events ?? []) as any[]) {
    if (!ev.model_id) continue;
    const s = modelRuns.get(ev.model_id) ?? new Set<string>();
    s.add(ev.run_id);
    modelRuns.set(ev.model_id, s);
  }

  const models: ModelStat[] = [];
  for (const [model_id, runSet] of modelRuns.entries()) {
    const latencies: number[] = [];
    let errors = 0, totalTokens = 0, early = 0, earlyErr = 0;

    for (const runId of runSet) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = runById.get(runId);
      if (!r) continue;
      if (r.status === "error") errors++;
      totalTokens += r.total_tokens ?? 0;
      if (r.started_at && r.ended_at) {
        const ms = new Date(r.ended_at).getTime() - new Date(r.started_at).getTime();
        if (ms >= 0 && ms < 3_600_000) latencies.push(ms);
      }
      if (r.created_at < midpoint) { early++; if (r.status === "error") earlyErr++; }
    }

    latencies.sort((a, b) => a - b);
    const runsCount = runSet.size;
    const errorRate = runsCount > 0 ? errors / runsCount : 0;
    const earlyRate = early > 0 ? earlyErr / early : 0;
    const lateRuns = runsCount - early, lateErr = errors - earlyErr;
    const lateRate = lateRuns > 0 ? lateErr / lateRuns : 0;
    const trend: ModelStat["trend"] =
      Math.abs(lateRate - earlyRate) < 0.02 ? "stable" :
      lateRate < earlyRate ? "improving" : "degrading";

    models.push({
      model_id,
      runs: runsCount,
      errors,
      errorRate,
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0,
      p95LatencyMs: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0,
      totalTokens,
      avgTokensPerRun: runsCount > 0 ? Math.round(totalTokens / runsCount) : 0,
      trend,
    });
  }

  models.sort((a, b) => b.runs - a.runs);
  const qualified = models.filter((m) => m.runs >= 10);
  const worstModel = qualified.length ? qualified.reduce((w, m) => m.errorRate > w.errorRate ? m : w, qualified[0]).model_id : null;
  const bestModel = qualified.length ? qualified.reduce((b, m) => m.errorRate < b.errorRate ? m : b, qualified[0]).model_id : null;

  return { models, windowDays, worstModel, bestModel };
}
