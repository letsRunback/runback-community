/**
 * Policy simulation — run a CANDIDATE policy against your history.
 *
 * "If this policy had been live, what would it have done?" — evaluated against the
 * recorded LLM decisions of your past runs, deterministically (no model calls, no
 * replay). For each run we check every decision step; a run "would be blocked" if
 * any decision violates the policy. The output names the exact runs (and the
 * failing rule), so a risk owner sees real incidents it would have caught before
 * enforcing it. A pure read over recorded data — see docs/DEEP_REPLAY_SPEC.md §1.4.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import type { PolicyRule } from "@/lib/eval/policy";
import type { LlmEvent } from "@runback/schema";
import { wouldBlock, type PolicySimResult, type PolicySimRun } from "@/lib/eval/policySimCore";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so reads are capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

export type { PolicySimResult, PolicySimRun } from "@/lib/eval/policySimCore";

/**
 * Simulate `rules` against the org's recent runs. Returns counts + the exact runs
 * it would have blocked. `limit` bounds how many recent runs are examined.
 */
export async function simulatePolicyOverRuns(
  orgId: string,
  rules: PolicyRule[],
  limit = 100
): Promise<PolicySimResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const { data: runs } = await sb
    .from("ad_runs")
    .select("run_id,name")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const runRows = (runs ?? []) as { run_id: string; name: string | null }[];
  if (runRows.length === 0) {
    return { total: 0, blocked: 0, allowed: 0, notApplicable: 0, blockRate: 0, affected: [] };
  }

  const runIds = runRows.map((r) => r.run_id);
  const { data: evRows } = await sb
    .from("ad_events")
    .select("run_id,data")
    .eq("org_id", orgId)
    .in("run_id", runIds)
    .eq("type", "llm")
    // wouldBlock() replays decisions in order to accumulate prior tool calls the
    // same way runtime enforcement does — unordered rows would make that
    // accumulation depend on Postgres's return order instead of the run's
    // actual timeline.
    .order("seq", { ascending: true })
    .limit(MAX_ROWS);

  // Group the recorded LLM decisions by run.
  const byRun = new Map<string, LlmEvent[]>();
  for (const row of (evRows ?? []) as { run_id: string; data: LlmEvent }[]) {
    const arr = byRun.get(row.run_id) ?? [];
    arr.push(row.data);
    byRun.set(row.run_id, arr);
  }

  let blocked = 0;
  let allowed = 0;
  let notApplicable = 0;
  const affected: PolicySimRun[] = [];

  for (const run of runRows) {
    const decisions = byRun.get(run.run_id) ?? [];
    if (decisions.length === 0) { notApplicable++; continue; }
    const v = wouldBlock(decisions, rules);
    if (v.blocked) {
      blocked++;
      affected.push({ run_id: run.run_id, name: run.name, detail: v.detail ?? "policy violated" });
    } else {
      allowed++;
    }
  }

  const examined = blocked + allowed;
  return {
    total: runRows.length,
    blocked,
    allowed,
    notApplicable,
    blockRate: examined ? blocked / examined : 0,
    affected,
  };
}
