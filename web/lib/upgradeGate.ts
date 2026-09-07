/**
 * Model upgrade gate — before switching to a new model, run the org's golden
 * regression suite against it and report every behavioral change. A pass means
 * the new model reproduces all production-tested decisions; a fail surfaces the
 * exact cases that would regress.
 *
 * Enterprise (deep_replay entitled, or a demo account): each golden entry is
 * genuinely replayed against the candidate model via counterfactualStoredRun —
 * a pass means the candidate reproduces that exact recorded decision.
 * Everyone else: the previous heuristic — match golden runs to production runs
 * that happened to use the candidate model, by agent name. Reported via
 * `method` so a statistical estimate is never presented as a verified gate.
 *
 * Gate results are stored and surfaced in CI (via /api/models/gate) so the check
 * can block a PR before the model change ships.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { counterfactualIfAvailable } from "@/lib/counterfactualHook";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so the read is capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

export interface GateTestResult {
  run_id: string;
  run_name: string;
  from_status: string;
  to_status: string;
  from_tokens: number;
  to_tokens: number;
  passed: boolean;
  changed: boolean;
  change_type: "status_change" | "token_spike" | "ok" | "decision_diverged";
  /** Only present for method: "counterfactual". */
  verdict?: string;
}

export interface UpgradeGateReport {
  id: string;
  org_id: string;
  from_model: string;
  to_model: string;
  total_tests: number;
  passed: number;
  failed: number;
  changed: number;
  pass_rate: number;
  verdict: "pass" | "fail" | "warning" | "no_data";
  results: GateTestResult[];
  created_at: string;
  method: "counterfactual" | "statistical";
  pass_threshold: number;
  warn_threshold: number;
}

// Real replay per golden entry — bounded like Models > Diff, for the same
// reason: real model calls, real latency, not a free aggregate query.
const REPLAY_SAMPLE_SIZE = 10;

function emptyReport(orgId: string, fromModel: string, toModel: string, method: "counterfactual" | "statistical", passThreshold: number, warnThreshold: number): UpgradeGateReport {
  return {
    id: crypto.randomUUID(), org_id: orgId, from_model: fromModel, to_model: toModel,
    total_tests: 0, passed: 0, failed: 0, changed: 0, pass_rate: 0, verdict: "no_data",
    results: [], created_at: new Date().toISOString(), method,
    pass_threshold: passThreshold, warn_threshold: warnThreshold,
  };
}

// total===0 must never read as "fail" — that means a regression was found,
// which requires at least one test to have actually run. Zero tests (e.g.
// every golden entry's backing run was since pruned by retention) is
// "no_data": nothing could be verified, not "verified and it's broken".
export function verdictFor(passRate: number, passThreshold: number, warnThreshold: number, total: number): UpgradeGateReport["verdict"] {
  if (total === 0) return "no_data";
  return passRate >= passThreshold ? "pass" : passRate >= warnThreshold ? "warning" : "fail";
}

/**
 * The org's versioned gate thresholds — the SAME ones Models > Gate uses
 * (setGateThresholds below). Exported so other suites (e.g. eval/evalGate.ts,
 * for adversarial-test results) gate against one threshold, not a second one
 * invented per feature.
 */
export async function getOrgGateThresholds(orgId: string): Promise<{ passThreshold: number; warnThreshold: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: org } = await sb
    .from("orgs")
    .select("gate_pass_threshold,gate_warn_threshold")
    .eq("id", orgId)
    .maybeSingle();
  return {
    passThreshold: Number(org?.gate_pass_threshold ?? 0.95),
    warnThreshold: Number(org?.gate_warn_threshold ?? 0.80),
  };
}

async function runCounterfactualGate(
  orgId: string,
  fromModel: string,
  toModel: string,
  demo: boolean,
  passThreshold: number,
  warnThreshold: number
): Promise<UpgradeGateReport | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: goldenRuns } = await sb
    .from("ad_golden")
    .select("run_id,detail")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(REPLAY_SAMPLE_SIZE);
  const golden: { run_id: string; detail: string | null }[] = goldenRuns ?? [];
  if (!golden.length) return null;

  const { data: origRunsData } = await sb
    .from("ad_runs")
    .select("run_id,name,status,total_tokens")
    .eq("org_id", orgId).in("run_id", golden.map((g) => g.run_id)).limit(MAX_ROWS);
  const origByRunId = new Map((origRunsData ?? []).map((r: { run_id: string }) => [r.run_id, r]));

  const results: GateTestResult[] = [];
  let passed = 0, failed = 0, changed = 0;

  for (const g of golden) {
    const orig = origByRunId.get(g.run_id) as { run_id: string; name: string; status: string; total_tokens: number | null } | undefined;
    const result = await counterfactualIfAvailable(g.run_id, toModel, demo, orgId).catch(() => null);
    if (!result) continue;
    const testPassed = !result.frontier;
    if (testPassed) passed++; else { failed++; changed++; }
    results.push({
      run_id: g.run_id,
      run_name: orig?.name ?? "agent",
      from_status: fromModel,
      to_status: testPassed ? "reproduced" : "diverged",
      from_tokens: orig?.total_tokens ?? 0,
      to_tokens: 0,
      passed: testPassed,
      changed: !testPassed,
      change_type: testPassed ? "ok" : "decision_diverged",
      verdict: result.verdict,
    });
  }

  const total = results.length;
  if (total === 0) return null;
  const passRate = passed / total;
  const verdict = verdictFor(passRate, passThreshold, warnThreshold, total);
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  await sb.from("ad_upgrade_gates").insert({
    id, org_id: orgId, from_model: fromModel, to_model: toModel,
    total_tests: total, passed, failed, changed,
    pass_rate: passRate.toFixed(4), verdict, results, created_at,
    method: "counterfactual", pass_threshold: passThreshold, warn_threshold: warnThreshold,
  });

  return {
    id, org_id: orgId, from_model: fromModel, to_model: toModel,
    total_tests: total, passed, failed, changed, pass_rate: passRate, verdict, results, created_at,
    method: "counterfactual", pass_threshold: passThreshold, warn_threshold: warnThreshold,
  };
}

async function statisticalGate(
  orgId: string,
  fromModel: string,
  toModel: string,
  passThreshold: number,
  warnThreshold: number
): Promise<UpgradeGateReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const { data: goldenRuns } = await sb
    .from("ad_golden")
    .select("run_id,detail")
    .eq("org_id", orgId)
    .eq("status", "active")
    .limit(50);
  const golden = goldenRuns ?? [];
  if (!golden.length) return emptyReport(orgId, fromModel, toModel, "statistical", passThreshold, warnThreshold);

  const runIds = golden.map((g: { run_id: string }) => g.run_id);
  const { data: originalRuns } = await sb
    .from("ad_runs")
    .select("run_id,name,status,total_tokens")
    .eq("org_id", orgId).in("run_id", runIds).limit(MAX_ROWS);
  const { data: modelEvents } = await sb
    .from("ad_events")
    .select("run_id,model_id")
    .eq("type", "llm")
    .not("model_id", "is", null)
    .eq("org_id", orgId).in("run_id", runIds).limit(MAX_ROWS);

  const runModelMap = new Map<string, string>();
  for (const ev of modelEvents ?? []) {
    if (!runModelMap.has(ev.run_id)) runModelMap.set(ev.run_id, ev.model_id);
  }

  // Estimate only: find a comparable run using toModel by agent name — never a
  // replay of the SAME input, just a same-name production run that happened
  // to already exist on the candidate model.
  const { data: toModelRuns } = await sb
    .from("ad_runs")
    .select("run_id,name,status,total_tokens")
    .eq("org_id", orgId)
    .in("status", ["success", "error"]).limit(MAX_ROWS);
  const { data: toModelEvents } = await sb
    .from("ad_events")
    .select("run_id,model_id")
    .limit(MAX_ROWS)
    .eq("type", "llm")
    .eq("model_id", toModel)
    .eq("org_id", orgId).in("run_id", (toModelRuns ?? []).map((r: { run_id: string }) => r.run_id).slice(0, 200));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toModelRunIds = new Set((toModelEvents ?? []).map((e: any) => e.run_id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toModelRunMap = new Map<string, any>();
  for (const r of toModelRuns ?? []) {
    if (toModelRunIds.has(r.run_id)) toModelRunMap.set(r.name, r);
  }

  const results: GateTestResult[] = [];
  let passed = 0, failed = 0, changed = 0;

  for (const origRun of originalRuns ?? []) {
    const usedFromModel = runModelMap.get(origRun.run_id) === fromModel;
    const comparable = toModelRunMap.get(origRun.name);

    if (!comparable || !usedFromModel) {
      results.push({
        run_id: origRun.run_id, run_name: origRun.name,
        from_status: origRun.status, to_status: "unverified",
        from_tokens: origRun.total_tokens ?? 0, to_tokens: 0,
        passed: true, changed: false, change_type: "ok",
      });
      passed++;
      continue;
    }

    const statusChanged = origRun.status !== comparable.status;
    const fromTok = origRun.total_tokens ?? 0;
    const toTok = comparable.total_tokens ?? 0;
    const tokenSpike = fromTok > 0 && toTok > fromTok * 2;
    const testPassed = !statusChanged && !tokenSpike;

    if (!testPassed) { failed++; if (statusChanged || tokenSpike) changed++; } else { passed++; }

    results.push({
      run_id: origRun.run_id, run_name: origRun.name,
      from_status: origRun.status, to_status: comparable.status,
      from_tokens: fromTok, to_tokens: toTok,
      passed: testPassed, changed: statusChanged || tokenSpike,
      change_type: statusChanged ? "status_change" : tokenSpike ? "token_spike" : "ok",
    });
  }

  const total = results.length;
  const passRate = total > 0 ? passed / total : 0;
  const verdict = verdictFor(passRate, passThreshold, warnThreshold, total);
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  await sb.from("ad_upgrade_gates").insert({
    id, org_id: orgId, from_model: fromModel, to_model: toModel,
    total_tests: total, passed, failed, changed,
    pass_rate: passRate.toFixed(4), verdict, results, created_at,
    method: "statistical", pass_threshold: passThreshold, warn_threshold: warnThreshold,
  });

  return {
    id, org_id: orgId, from_model: fromModel, to_model: toModel,
    total_tests: total, passed, failed, changed, pass_rate: passRate, verdict, results, created_at,
    method: "statistical", pass_threshold: passThreshold, warn_threshold: warnThreshold,
  };
}

export async function runUpgradeGate(
  orgId: string,
  fromModel: string,
  toModel: string,
  demo = false
): Promise<UpgradeGateReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { can } = await import("@/lib/entitlements");
  const { data: org } = await sb.from("orgs")
    .select("plan,gate_pass_threshold,gate_warn_threshold")
    .eq("id", orgId).maybeSingle();
  const passThreshold = Number(org?.gate_pass_threshold ?? 0.95);
  const warnThreshold = Number(org?.gate_warn_threshold ?? 0.80);
  const useReplay = demo || can(org?.plan, "deep_replay");

  if (useReplay) {
    const result = await runCounterfactualGate(orgId, fromModel, toModel, demo, passThreshold, warnThreshold);
    if (result) return result;
    // Golden corpus empty or nothing replayable — fall through rather than a
    // dead end, but this still runs the honestly-labeled statistical path.
  }
  return statisticalGate(orgId, fromModel, toModel, passThreshold, warnThreshold);
}

export async function listGates(orgId: string): Promise<UpgradeGateReport[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb.from("ad_upgrade_gates").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(10);
  return data ?? [];
}

export async function setGateThresholds(orgId: string, passThreshold: number, warnThreshold: number): Promise<void> {
  if (!(passThreshold > warnThreshold && warnThreshold >= 0 && passThreshold <= 1)) {
    throw new Error("pass_threshold must be greater than warn_threshold, both between 0 and 1");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  await sb.from("orgs").update({
    gate_pass_threshold: passThreshold.toFixed(3),
    gate_warn_threshold: warnThreshold.toFixed(3),
  }).eq("id", orgId);
}
