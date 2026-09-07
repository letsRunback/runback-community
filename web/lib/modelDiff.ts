/**
 * Model diff — compare behavioral divergence between two model versions.
 *
 * Enterprise (deep_replay entitled, or a demo account): genuine counterfactual
 * replay. For a sample of runs actually captured on model A, re-execute each
 * against model B via @runback/replay's counterfactualRunHybrid and report
 * real decision divergence, not an inference.
 *
 * Everyone else: the previous methodology — compare aggregate error rates
 * between the two sets of runs that happened to run on each model, by agent
 * name. This is a correlation, not a causal replay (same agent name, but the
 * two run-sets never saw the same input), and the report says so via `method`.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { counterfactualIfAvailable } from "@/lib/counterfactualHook";
import { scoreDivergence, type DivergenceCategory } from "@runback/replay";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so the read is capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

export interface DivergenceExample {
  agent_name: string;
  model_a_status: string;
  model_b_status: string;
  model_a_tokens: number;
  model_b_tokens: number;
  severity: "critical" | "minor";
  policy_impact: boolean;
  /** Only present for method: "counterfactual" — the actual replay verdict. */
  run_id?: string;
  verdict?: string;
  /**
   * What actually changed, not just that something did — computed from the
   * real captured tool-call/text structure at the frontier step (see
   * @runback/replay's scoreDivergence). Only present for method:
   * "counterfactual", since it needs the structured per-step decision data
   * a real replay produces; the statistical path only has aggregate rates.
   */
  divergence_category?: DivergenceCategory;
  /** 0-100, from scoreDivergence — a finer signal than the critical/minor bucket above, which this doesn't replace (kept for backward compatibility with existing dashboards/alerts keyed on it). */
  divergence_severity_score?: number;
  divergence_reason?: string;
}

export interface ModelDiffReport {
  model_a: string;
  model_b: string;
  window_days: number;
  total_compared: number;
  diverged: number;
  divergence_rate: number;
  critical_count: number;
  policy_impact: boolean;
  token_delta_pct: number;
  examples: DivergenceExample[];
  a_error_rate: number;
  b_error_rate: number;
  a_avg_tokens: number;
  b_avg_tokens: number;
  cached: boolean;
  /** "counterfactual" = real replay (Enterprise/demo). "statistical" = the
   *  correlation-based estimate, run for orgs without deep_replay. */
  method: "counterfactual" | "statistical";
}

// Bounded so an interactive page load doesn't spend unbounded real model
// tokens or blow the route's execution time limit — this is a real replay
// per run, not a free aggregate query.
const COUNTERFACTUAL_SAMPLE_SIZE = 5;

async function runCounterfactualDiff(
  orgId: string,
  modelA: string,
  modelB: string,
  windowDays: number,
  demo: boolean
): Promise<ModelDiffReport | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  // Scoped to the caller's org.
  //
  // Without the filter this selected across every tenant and took the first
  // 2000 rows. No data leaked — the ids are intersected with an org-scoped
  // query below — but on a busy deployment other tenants' events filled the
  // window, leaving no candidates for the caller and returning null. A feature
  // that quietly stops working as the platform gets busier is hard to diagnose,
  // because it fails only in production and only under load.
  const { data: modelEvents } = await sb
    .from("ad_events")
    .select("run_id,seq")
    .eq("org_id", orgId)
    .eq("type", "llm")
    .eq("model_id", modelA)
    .order("seq", { ascending: true })
    .limit(2000);
  const candidateRunIds = [...new Set((modelEvents ?? []).map((e: { run_id: string }) => e.run_id))] as string[];
  if (!candidateRunIds.length) return null;

  const { data: runs } = await sb
    .from("ad_runs")
    .select("run_id,name,total_tokens")
    .eq("org_id", orgId)
    .in("run_id", candidateRunIds)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(COUNTERFACTUAL_SAMPLE_SIZE);
  const sample: { run_id: string; name: string | null; total_tokens: number | null }[] = runs ?? [];
  if (!sample.length) return null;

  const examples: DivergenceExample[] = [];
  let diverged = 0;
  let criticalCount = 0;

  for (const run of sample) {
    const result = await counterfactualIfAvailable(run.run_id, modelB, demo, orgId).catch(() => null);
    if (!result) continue;
    if (result.frontier) {
      diverged++;
      // A divergence in the first 2 steps (early, before much context accrues)
      // or affecting most of the run is more likely to change the outcome a
      // customer sees, not just internal phrasing — a reasonable proxy for
      // "critical" without re-litigating severity scoring here.
      const severity: "critical" | "minor" =
        result.frontier.seq <= 2 || result.divergedSteps / Math.max(1, result.totalLlmSteps) > 0.5
          ? "critical"
          : "minor";
      if (severity === "critical") criticalCount++;

      // The frontier only carries string descriptions ("calls issue_refund"
      // vs "answers (stop)"); the structured decision that produced them is
      // on the matching step. Score what actually changed, not just that
      // something did — this is why the counterfactual path exists over the
      // statistical one: real per-step decision data to read, not just
      // aggregate rates.
      const frontierStep = result.steps.find((s) => s.seq === result.frontier!.seq);
      const scored = frontierStep?.counterfactual
        ? scoreDivergence(frontierStep.recorded, frontierStep.counterfactual)
        : null;

      examples.push({
        agent_name: run.name ?? "agent",
        model_a_status: "recorded",
        model_b_status: "diverged",
        model_a_tokens: run.total_tokens ?? 0,
        model_b_tokens: 0,
        severity,
        policy_impact: false,
        run_id: run.run_id,
        verdict: result.verdict,
        divergence_category: scored?.category,
        divergence_severity_score: scored?.severity,
        divergence_reason: scored?.reason,
      });
    }
  }

  const totalCompared = sample.length;
  const divergenceRate = totalCompared > 0 ? diverged / totalCompared : 0;

  await sb.from("ad_model_diffs").upsert({
    org_id: orgId, model_a: modelA, model_b: modelB, window_days: windowDays,
    run_count: totalCompared, diverged_count: diverged,
    divergence_rate: divergenceRate.toFixed(4),
    critical_count: criticalCount, policy_impact: false, examples, status: "complete",
    method: "counterfactual",
  }, { onConflict: "org_id,model_a,model_b,window_days" });

  return {
    model_a: modelA, model_b: modelB, window_days: windowDays,
    total_compared: totalCompared, diverged, divergence_rate: divergenceRate,
    critical_count: criticalCount, policy_impact: false,
    token_delta_pct: 0,
    examples,
    a_error_rate: 0, b_error_rate: 0,
    a_avg_tokens: 0, b_avg_tokens: 0,
    cached: false,
    method: "counterfactual",
  };
}

async function statisticalModelDiff(
  orgId: string,
  modelA: string,
  modelB: string,
  windowDays: number
): Promise<ModelDiffReport | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const { data: aRuns } = await sb
    .from("ad_runs")
    .select("run_id,name,status,total_tokens,step_count")
    .eq("org_id", orgId)
    .gte("started_at", since)
    .in("status", ["success", "error"]).limit(MAX_ROWS);

  const { data: modelEvents } = await sb
    .from("ad_events")
    .select("run_id,model_id")
    .eq("type", "llm")
    .not("model_id", "is", null)
    .eq("org_id", orgId).in("run_id", (aRuns ?? []).map((r: { run_id: string }) => r.run_id)).limit(MAX_ROWS);

  const runModelMap = new Map<string, string[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ev of (modelEvents ?? []) as any[]) {
    const arr = runModelMap.get(ev.run_id) ?? [];
    if (!arr.includes(ev.model_id)) arr.push(ev.model_id);
    runModelMap.set(ev.run_id, arr);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aRunsFull = (aRuns ?? []).map((r: any) => ({ ...r, models: runModelMap.get(r.run_id) ?? [] }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aModelRuns = aRunsFull.filter((r: any) => r.models.includes(modelA));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bModelRuns = aRunsFull.filter((r: any) => r.models.includes(modelB));
  if (!aModelRuns.length && !bModelRuns.length) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aByName = new Map<string, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bByName = new Map<string, any[]>();
   
  for (const r of aModelRuns) { const arr = aByName.get(r.name) ?? []; arr.push(r); aByName.set(r.name, arr); }
   
  for (const r of bModelRuns) { const arr = bByName.get(r.name) ?? []; arr.push(r); bByName.set(r.name, arr); }

  const allRunIds = [...aModelRuns, ...bModelRuns].map((r: { run_id: string }) => r.run_id);
  const { data: policyEvents } = allRunIds.length ? await sb
    .from("ad_events")
    .select("run_id")
    .eq("type", "tool")
    .eq("policy_blocked", true)
    // No .slice(): dropping run ids past an arbitrary 500 quietly excluded
    // those runs from the policy-block comparison, biasing the diff toward
    // whichever model happened to be sampled first.
    .eq("org_id", orgId).in("run_id", allRunIds).limit(MAX_ROWS) : { data: [] };
  const policyBlockedSet = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (policyEvents ?? []).map((e: any) => e.run_id)
  );

  const sharedAgents = [...aByName.keys()].filter((n) => bByName.has(n));
  const examples: DivergenceExample[] = [];
  let totalCompared = 0, diverged = 0, criticalCount = 0, policyImpact = false;

  for (const agentName of sharedAgents) {
    const aGroup = aByName.get(agentName)!;
    const bGroup = bByName.get(agentName)!;
    totalCompared++;
    const aErrRate = aGroup.filter((r) => r.status === "error").length / aGroup.length;
    const bErrRate = bGroup.filter((r) => r.status === "error").length / bGroup.length;
    const diverged_ = Math.abs(aErrRate - bErrRate) > 0.05;
    if (diverged_) {
      diverged++;
      const severity: "critical" | "minor" = Math.abs(aErrRate - bErrRate) > 0.15 ? "critical" : "minor";
      if (severity === "critical") criticalCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentPolicyImpact = [...aGroup, ...bGroup].some((r: any) => policyBlockedSet.has(r.run_id));
      if (agentPolicyImpact) policyImpact = true;
      if (examples.length < 5) {
        examples.push({
          agent_name: agentName,
          model_a_status: aErrRate > 0.1 ? "error" : "success",
          model_b_status: bErrRate > 0.1 ? "error" : "success",
          model_a_tokens: Math.round(aGroup.reduce((s, r) => s + (r.total_tokens ?? 0), 0) / aGroup.length),
          model_b_tokens: Math.round(bGroup.reduce((s, r) => s + (r.total_tokens ?? 0), 0) / bGroup.length),
          severity, policy_impact: agentPolicyImpact,
        });
      }
    }
  }

  const divergenceRate = totalCompared > 0 ? diverged / totalCompared : 0;
  const aAvgTok = aModelRuns.reduce((s: number, r: { total_tokens?: number }) => s + (r.total_tokens ?? 0), 0) / Math.max(1, aModelRuns.length);
  const bAvgTok = bModelRuns.reduce((s: number, r: { total_tokens?: number }) => s + (r.total_tokens ?? 0), 0) / Math.max(1, bModelRuns.length);
  const tokenDelta = aAvgTok > 0 ? ((bAvgTok - aAvgTok) / aAvgTok) * 100 : 0;
  const aErrRate = aModelRuns.filter((r: { status: string }) => r.status === "error").length / Math.max(1, aModelRuns.length);
  const bErrRate = bModelRuns.filter((r: { status: string }) => r.status === "error").length / Math.max(1, bModelRuns.length);

  await sb.from("ad_model_diffs").upsert({
    org_id: orgId, model_a: modelA, model_b: modelB, window_days: windowDays,
    run_count: totalCompared, diverged_count: diverged,
    divergence_rate: divergenceRate.toFixed(4),
    critical_count: criticalCount, policy_impact: policyImpact, examples, status: "complete",
    a_avg_tokens: Math.round(aAvgTok), b_avg_tokens: Math.round(bAvgTok),
    token_delta_pct: tokenDelta.toFixed(2),
    a_error_rate: aErrRate.toFixed(4), b_error_rate: bErrRate.toFixed(4),
    method: "statistical",
  }, { onConflict: "org_id,model_a,model_b,window_days" });

  return {
    model_a: modelA, model_b: modelB, window_days: windowDays,
    total_compared: totalCompared, diverged, divergence_rate: divergenceRate,
    critical_count: criticalCount, policy_impact: policyImpact,
    token_delta_pct: tokenDelta,
    examples, a_error_rate: aErrRate, b_error_rate: bErrRate,
    a_avg_tokens: Math.round(aAvgTok), b_avg_tokens: Math.round(bAvgTok),
    cached: false,
    method: "statistical",
  };
}

export async function getModelDiff(
  orgId: string,
  modelA: string,
  modelB: string,
  windowDays = 30,
  demo = false
): Promise<ModelDiffReport | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { can } = await import("@/lib/entitlements");
  const { data: org } = await sb.from("orgs").select("plan").eq("id", orgId).maybeSingle();
  const useReplay = demo || can(org?.plan, "deep_replay");

  const { data: cached } = await sb
    .from("ad_model_diffs")
    .select("*")
    .eq("org_id", orgId).eq("model_a", modelA).eq("model_b", modelB).eq("window_days", windowDays)
    .maybeSingle();
  // Only trust a cache entry produced by the methodology we'd use right now —
  // a stale statistical cache must never be served as if it were a real replay.
  if (cached && cached.method === (useReplay ? "counterfactual" : "statistical")) {
    return {
      model_a: modelA, model_b: modelB, window_days: windowDays,
      total_compared: cached.run_count,
      diverged: cached.diverged_count,
      divergence_rate: Number(cached.divergence_rate ?? 0),
      critical_count: cached.critical_count,
      policy_impact: cached.policy_impact,
      token_delta_pct: Number(cached.token_delta_pct ?? 0),
      examples: cached.examples ?? [],
      a_error_rate: Number(cached.a_error_rate ?? 0),
      b_error_rate: Number(cached.b_error_rate ?? 0),
      a_avg_tokens: cached.a_avg_tokens ?? 0,
      b_avg_tokens: cached.b_avg_tokens ?? 0,
      cached: true,
      method: cached.method,
    };
  }

  if (useReplay) {
    const result = await runCounterfactualDiff(orgId, modelA, modelB, windowDays, demo);
    if (result) return result;
    // No runs captured on model A to replay — fall through to the
    // statistical view rather than a dead end, but keep it labeled honestly.
  }
  return statisticalModelDiff(orgId, modelA, modelB, windowDays);
}

export async function listOrgModels(orgId: string, windowDays = 30): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const { data: runs } = await sb.from("ad_runs").select("run_id").eq("org_id", orgId).gte("started_at", since).limit(MAX_ROWS);
  const runIds = (runs ?? []).map((r: { run_id: string }) => r.run_id);
  if (!runIds.length) return [];
  // Lists which models an org has actually used. The .slice(0, 200) meant a
  // model only used by older runs simply never appeared in the picker.
  const { data } = await sb.from("ad_events").select("model_id").eq("org_id", orgId).eq("type", "llm").not("model_id", "is", null).in("run_id", runIds).limit(MAX_ROWS);
  const models = [...new Set((data ?? []).map((e: { model_id: string }) => e.model_id))] as string[];
  return models.sort();
}
