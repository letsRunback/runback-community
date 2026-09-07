/**
 * Behavioral drift detection.
 *
 * Compares an org's agent behavior in the "current" window (last 7 days)
 * against a stable "baseline" window (30–8 days ago). Z-scores each
 * behavioral signal using the baseline's per-day variance, then fires
 * an alert when any signal exceeds threshold.
 *
 * Data source: ad_run_rollups (daily pre-aggregated — O(days), not O(runs)).
 * Tool distribution is pulled from ad_events for the deepest signal.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { tryRead } from "@/lib/supabase/read";

export type DriftSeverity = "ok" | "info" | "warning" | "critical";

export interface DriftSignal {
  metric: string;
  label: string;
  unit: string;
  baseline_mean: number;
  current_mean: number;
  z_score: number;
  pct_change: number;
  direction: "increase" | "decrease" | "stable";
  severity: DriftSeverity;
}

export interface AgentDriftResult {
  agent: string;
  drift_score: number;
  severity: DriftSeverity;
  signals: DriftSignal[];
  all_signals: DriftSignal[];
  baseline_runs: number;
  current_runs: number;
  baseline_start: string;
  baseline_end: string;
  current_start: string;
  current_end: string;
  alert_id?: string;
}

export interface RecentAlert {
  id: string;
  agent: string;
  detected_at: string;
  severity: DriftSeverity;
  drift_score: number;
  signals: DriftSignal[];
  baseline_start: string;
  baseline_end: string;
  current_start: string;
  current_end: string;
  baseline_runs: number;
  current_runs: number;
  acknowledged_at: string | null;
}

export interface DriftReport {
  org_id: string;
  computed_at: string;
  overall_severity: DriftSeverity;
  overall_score: number;
  agents: AgentDriftResult[];
  recent_alerts: RecentAlert[];
}

// Z-score thresholds for severity tiers
const Z_INFO     = 1.5;
const Z_WARNING  = 2.0;
const Z_CRITICAL = 3.0;

// Minimum run counts before drift is meaningful
const MIN_BASELINE_RUNS = 5;
const MIN_CURRENT_RUNS  = 3;

// Avoid division by zero; also sets a noise floor
const EPSILON = 1e-9;

function _mean(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function _std(vals: number[], mu: number): number {
  if (vals.length < 2) return 0;
  const variance = vals.reduce((s, v) => s + (v - mu) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(variance);
}

/**
 * Standard-error floor for a RATE metric (error_rate, success_rate — both
 * proportions in [0,1]), sized to the current window's sample size instead
 * of the fixed EPSILON used everywhere else.
 *
 * Day-to-day baseline variance collapses toward zero for any agent with a
 * near-constant rate — 0% errors for three weeks is the common case at low
 * volume, not the exception — and EPSILON alone as the z-score denominator
 * turned that into an automatic "critical" alert on the very first nonzero
 * day, independent of how many runs that day actually had. One error in 100
 * runs is not the same signal as one error in 3. Uses the binomial standard
 * error sqrt(p(1-p)/n), with p floored away from the degenerate 0/1 extremes
 * — the same continuity correction a Wilson-score interval applies for
 * exactly this edge case.
 */
export function rateFloor(baselineRate: number, currentRuns: number): number {
  const p = Math.min(0.99, Math.max(0.01, baselineRate));
  return Math.sqrt((p * (1 - p)) / Math.max(1, currentRuns));
}

function zSeverity(z: number): DriftSeverity {
  const a = Math.abs(z);
  if (a >= Z_CRITICAL) return "critical";
  if (a >= Z_WARNING)  return "warning";
  if (a >= Z_INFO)     return "info";
  return "ok";
}

 
function buildSignal(metric: string, label: string, unit: string, bMean: number, cMean: number, z: number): DriftSignal {
  const pct = bMean > EPSILON ? ((cMean - bMean) / bMean) * 100 : 0;
  return {
    metric, label, unit,
    baseline_mean: bMean,
    current_mean: cMean,
    z_score: parseFloat(z.toFixed(3)),
    pct_change: parseFloat(pct.toFixed(1)),
    direction: cMean > bMean + EPSILON ? "increase" : cMean < bMean - EPSILON ? "decrease" : "stable",
    severity: zSeverity(z),
  };
}

/**
 * Compute drift for all agents of a single org.
 * Returns only agents that have enough data AND show detectable drift.
 */
export async function computeOrgDrift(orgId: string): Promise<AgentDriftResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const now = new Date();

  // Windows
  const bStart = new Date(now.getTime() - 30 * 86400_000);
  const bEnd   = new Date(now.getTime() -  8 * 86400_000);
  const cStart = new Date(now.getTime() -  7 * 86400_000);
  const cEnd   = now;

  const bStartIso = bStart.toISOString().slice(0, 10);
  const bEndIso   = bEnd.toISOString().slice(0, 10);
  const cStartIso = cStart.toISOString().slice(0, 10);
  const cEndIso   = cEnd.toISOString().slice(0, 10);

  // Pull rollups for both windows in one query
  const { data: rows } = await sb
    .from("ad_run_rollups")
    .select("day,agent,runs,errors,success,tokens,latency_sum,latency_count")
    .eq("org_id", orgId)
    .gte("day", bStartIso)
    .lte("day", cEndIso);

  if (!rows?.length) return [];

  // Pull tool call distribution from events for richer signal.
  //
  // Two bugs lived here, and together they zeroed this signal out entirely:
  //
  //  1. `.eq("org_id", orgId)` — ad_events has no org_id. Tenancy runs through
  //     ad_runs, so this 400'd on every call and `toolRows` came back undefined.
  //     Scope via the embedded relation instead, the same way benchmark.ts does.
  //  2. `ts_start` was read out of the `data` JSON blob rather than selected as
  //     the real column it is. Even had the query succeeded, every event would
  //     have had `ts = null`, so `inCurrent` and `inBaseline` were both false and
  //     both histograms stayed empty — which toolSimilarity() reports as 1.0,
  //     i.e. "no drift", the most dangerous possible default for this feature.
  const toolRows = await tryRead<Array<{ tool_name: string | null; ts_start: string | null }>>(
    sb
      .from("ad_events")
      .select("tool_name,ts_start,ad_runs!inner(org_id)")
      .eq("type", "tool")
      .eq("ad_runs.org_id", orgId)
      .gte("ts_start", bStart.toISOString())
      .lte("ts_start", cEnd.toISOString())
      .not("tool_name", "is", null)
      .limit(5000),
    "drift: load tool-call distribution",
    []
  );

  const bToolCounts: Record<string, number> = {};
  const cToolCounts: Record<string, number> = {};
  for (const e of toolRows) {
    if (!e.tool_name || !e.ts_start) continue;
    const ts = new Date(e.ts_start);
    if (ts >= cStart) cToolCounts[e.tool_name] = (cToolCounts[e.tool_name] ?? 0) + 1;
    else if (ts >= bStart && ts <= bEnd) bToolCounts[e.tool_name] = (bToolCounts[e.tool_name] ?? 0) + 1;
  }

  // Compute tool distribution similarity (cosine similarity between tool freq vectors)
  function toolSimilarity(a: Record<string, number>, b: Record<string, number>): number {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let dot = 0, magA = 0, magB = 0;
    for (const k of keys) {
      const av = a[k] ?? 0, bv = b[k] ?? 0;
      dot += av * bv; magA += av * av; magB += bv * bv;
    }
    if (!magA || !magB) return 1; // no tools = no change
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }
  const toolSim = toolSimilarity(bToolCounts, cToolCounts);

  // Group rollup rows by agent
  const agentMap = new Map<string, typeof rows>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of rows as any[]) {
    if (!agentMap.has(r.agent)) agentMap.set(r.agent, []);
    agentMap.get(r.agent)!.push(r);
  }

  const results: AgentDriftResult[] = [];

  for (const [agent, agentRows] of agentMap) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bRows = (agentRows as any[]).filter((r) => r.day >= bStartIso && r.day <= bEndIso);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cRows = (agentRows as any[]).filter((r) => r.day >= cStartIso);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bRuns = bRows.reduce((s: number, r: any) => s + (r.runs ?? 0), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cRuns = cRows.reduce((s: number, r: any) => s + (r.runs ?? 0), 0);

    if (bRuns < MIN_BASELINE_RUNS || cRuns < MIN_CURRENT_RUNS) continue;

    // Per-day rates for baseline (variance comes from day-to-day variation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bErrRates    = bRows.filter((r: any) => r.runs > 0).map((r: any) => r.errors / r.runs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bTokPerRun   = bRows.filter((r: any) => r.runs > 0).map((r: any) => r.tokens / r.runs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bLatencies   = bRows.filter((r: any) => r.latency_count > 0).map((r: any) => r.latency_sum / r.latency_count);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bSuccRates   = bRows.filter((r: any) => r.runs > 0).map((r: any) => r.success / r.runs);

    // Current window: single mean from all days (small window, no per-day variance needed)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cErrRate  = _mean(cRows.filter((r: any) => r.runs > 0).map((r: any) => r.errors / r.runs));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cTokRun   = _mean(cRows.filter((r: any) => r.runs > 0).map((r: any) => r.tokens / r.runs));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cLatency  = _mean(cRows.filter((r: any) => r.latency_count > 0).map((r: any) => r.latency_sum / r.latency_count));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cSuccRate = _mean(cRows.filter((r: any) => r.runs > 0).map((r: any) => r.success / r.runs));

    const bErrMu  = _mean(bErrRates);
    const bTokMu  = _mean(bTokPerRun);
    const bLatMu  = _mean(bLatencies);
    const bSucMu  = _mean(bSuccRates);

    const bErrStd  = _std(bErrRates,  bErrMu);
    const bTokStd  = _std(bTokPerRun, bTokMu);
    const bLatStd  = _std(bLatencies, bLatMu);
    const bSucStd  = _std(bSuccRates, bSucMu);

    // Z-scores. error_rate and success_rate are proportions, so their
    // denominator is floored by sample-size-aware sampling noise (rateFloor),
    // not just EPSILON — see rateFloor's comment for why a near-zero
    // baseline variance otherwise makes them fire on noise.
    const zErr  = (cErrRate  - bErrMu)  / Math.max(bErrStd,  rateFloor(bErrMu, cRuns), EPSILON);
    const zTok  = (cTokRun   - bTokMu)  / Math.max(bTokStd,  EPSILON);
    const zLat  = (cLatency  - bLatMu)  / Math.max(bLatStd,  EPSILON);
    const zSuc  = (cSuccRate - bSucMu)  / Math.max(bSucStd,  rateFloor(bSucMu, cRuns), EPSILON);

    // Build all signals (for display even if not drifting)
    const allSignals: DriftSignal[] = [
      buildSignal("error_rate",    "Error rate",      "%",   bErrMu, cErrRate, zErr),
      buildSignal("tokens_per_run","Tokens per run",  "tok", bTokMu, cTokRun,  zTok),
      buildSignal("avg_latency",   "Avg latency",     "ms",  bLatMu, cLatency, zLat),
      buildSignal("success_rate",  "Success rate",    "%",   bSucMu, cSuccRate, zSuc),
    ];

    // Tool distribution signal (supplement the rollup signals)
    const toolDriftSignal: DriftSignal | null = (() => {
      const bTotal = Object.values(bToolCounts).reduce((s, v) => s + v, 0);
      const cTotal = Object.values(cToolCounts).reduce((s, v) => s + v, 0);
      if (!bTotal || !cTotal) return null;
      const shift = 1 - toolSim; // 0 = no change, 1 = completely different
      const severity: DriftSeverity = shift > 0.4 ? "critical" : shift > 0.25 ? "warning" : shift > 0.1 ? "info" : "ok";
      if (severity === "ok") return null;
      return {
        metric: "tool_distribution",
        label: "Tool usage pattern",
        unit: "%",
        baseline_mean: 100,
        current_mean: parseFloat(((1 - shift) * 100).toFixed(1)),
        z_score: parseFloat(((shift - 0) / 0.15).toFixed(2)), // treat 15% as 1σ
        pct_change: parseFloat((-shift * 100).toFixed(1)),
        direction: "decrease",
        severity,
      };
    })();
    if (toolDriftSignal) allSignals.push(toolDriftSignal);

    // Drifting = above info threshold
    const driftingSignals = allSignals.filter(s => s.severity !== "ok");

    if (!driftingSignals.length) continue;

    // RMS z-score → drift score 0-100
    const allZ = allSignals.map(s => Math.abs(s.z_score));
    const rmsZ = Math.sqrt(allZ.reduce((s, z) => s + z * z, 0) / allZ.length);
    const driftScore = Math.min(100, Math.round(rmsZ * 25));

    const severity: DriftSeverity =
      driftingSignals.some(s => s.severity === "critical") ? "critical" :
      driftingSignals.some(s => s.severity === "warning")  ? "warning"  : "info";

    results.push({
      agent,
      drift_score: driftScore,
      severity,
      signals: driftingSignals,
      all_signals: allSignals,
      baseline_runs: bRuns,
      current_runs:  cRuns,
      baseline_start: bStartIso,
      baseline_end:   bEndIso,
      current_start:  cStartIso,
      current_end:    cEndIso,
    });
  }

  return results.sort((a, b) => b.drift_score - a.drift_score);
}

/**
 * Persist drift results to ad_drift_alerts and return IDs.
 */
export async function persistDrift(orgId: string, drifts: AgentDriftResult[]): Promise<Map<string, string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const idMap = new Map<string, string>();
  for (const d of drifts) {
    const { data } = await sb.from("ad_drift_alerts").insert({
      org_id: orgId, agent: d.agent,
      severity: d.severity, drift_score: d.drift_score,
      signals: d.signals,
      baseline_start: d.baseline_start, baseline_end: d.baseline_end,
      current_start:  d.current_start,  current_end:  d.current_end,
      baseline_runs: d.baseline_runs,   current_runs: d.current_runs,
    }).select("id").single();
    if (data?.id) idMap.set(d.agent, data.id);
  }
  return idMap;
}

export async function getRecentAlerts(orgId: string): Promise<RecentAlert[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data } = await sb
    .from("ad_drift_alerts")
    .select("id,agent,detected_at,severity,drift_score,signals,baseline_start,baseline_end,current_start,current_end,baseline_runs,current_runs,acknowledged_at")
    .eq("org_id", orgId)
    .gte("detected_at", since)
    .order("detected_at", { ascending: false })
    .limit(50);
  return (data ?? []) as RecentAlert[];
}

export async function getDriftReport(orgId: string): Promise<DriftReport> {
  const [agents, recentAlerts] = await Promise.all([
    computeOrgDrift(orgId),
    getRecentAlerts(orgId),
  ]);

  const overallSeverity: DriftSeverity =
    agents.some(a => a.severity === "critical") ? "critical" :
    agents.some(a => a.severity === "warning")  ? "warning"  :
    agents.some(a => a.severity === "info")     ? "info"     : "ok";

  const overallScore = agents.length
    ? Math.round(agents.reduce((s, a) => s + a.drift_score, 0) / agents.length)
    : 0;

  return {
    org_id: orgId,
    computed_at: new Date().toISOString(),
    overall_severity: overallSeverity,
    overall_score: overallScore,
    agents,
    recent_alerts: recentAlerts,
  };
}
