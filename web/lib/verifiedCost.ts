/**
 * Cost per verified-successful replay — of the money spent on this fleet,
 * how much resulted in a decision actually PROVEN consistent via real
 * counterfactual replay (not just claimed)? "Verified" here means: the run's
 * outcome was checked by an Upgrade Gate (method: "counterfactual") and
 * passed — the candidate model reproduced the exact recorded decision, per
 * @runback/replay's counterfactualStoredRun, not a statistical estimate.
 *
 * This deliberately does NOT count every run as "verified" — most runs are
 * never replayed at all, so this metric is usually a small fraction of total
 * spend. That's the honest answer, not a bug: it measures replay coverage,
 * not run success.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { estimateCost, getCostAttribution } from "@/lib/costAttr";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so reads are capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

export interface VerifiedReplayCost {
  window_days: number;
  total_cost_usd: number;
  total_runs: number;
  verified_runs: number;
  verified_cost_usd: number;
  /** verified_cost_usd / total_cost_usd, or null when there's no spend to compare against. */
  verified_pct: number | null;
  cost_per_verified_run: number | null;
  generated_at: string;
}

export async function getVerifiedReplayCost(orgId: string, windowDays = 30): Promise<VerifiedReplayCost> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const now = new Date().toISOString();

  const [totalReport, { data: gates }] = await Promise.all([
    getCostAttribution(orgId, windowDays),
    sb.from("ad_upgrade_gates")
      .select("results")
      .eq("org_id", orgId)
      .eq("method", "counterfactual")
      .gte("created_at", since),
  ]);

  // Distinct run_ids that a real counterfactual replay verified as passing,
  // across every gate run in the window — a run_id can appear in more than
  // one gate, so dedupe before pricing it.
  const verifiedRunIds = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const gate of (gates ?? []) as any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (gate.results ?? []) as any[]) {
      if (r.passed && r.run_id) verifiedRunIds.add(r.run_id);
    }
  }

  if (verifiedRunIds.size === 0) {
    return {
      window_days: windowDays,
      total_cost_usd: totalReport.total_cost_usd,
      total_runs: totalReport.total_runs,
      verified_runs: 0,
      verified_cost_usd: 0,
      verified_pct: totalReport.total_cost_usd > 0 ? 0 : null,
      cost_per_verified_run: null,
      generated_at: now,
    };
  }

  // Price each verified run from its own recorded model + token usage — the
  // same per-run pricing idiom getCostAttribution uses, not the replay's cost
  // (the counterfactual engine doesn't report its own token usage today).
  //
  // `.in("run_id", ids)` was sliced to the first 500 ids, silently dropping
  // the rest — an org with more than 500 verified runs in the window got
  // verified_cost_usd (and therefore verified_pct and cost_per_verified_run)
  // priced from a fraction of what was actually verified, with nothing
  // marking the number as partial. Same bug class readAll() exists to
  // prevent for row-count truncation; here it's the IN-list that needs
  // chunking instead, so page through it explicitly.
  const runIdChunks: string[][] = [];
  const idList = [...verifiedRunIds];
  for (let i = 0; i < idList.length; i += 500) runIdChunks.push(idList.slice(i, i + 500));

  let verifiedCostUsd = 0;
  for (const chunk of runIdChunks) {
    const { data: llmEvents } = await sb
      .from("ad_events")
      .select("run_id,model_id,total_tokens")
      .eq("org_id", orgId)
      .eq("type", "llm")
      .not("model_id", "is", null)
      .in("run_id", chunk)
      .limit(MAX_ROWS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const ev of (llmEvents ?? []) as any[]) {
      verifiedCostUsd += estimateCost(ev.total_tokens ?? 0, ev.model_id);
    }
  }

  return {
    window_days: windowDays,
    total_cost_usd: totalReport.total_cost_usd,
    total_runs: totalReport.total_runs,
    verified_runs: verifiedRunIds.size,
    verified_cost_usd: verifiedCostUsd,
    verified_pct: totalReport.total_cost_usd > 0 ? verifiedCostUsd / totalReport.total_cost_usd : null,
    cost_per_verified_run: verifiedRunIds.size > 0 ? verifiedCostUsd / verifiedRunIds.size : null,
    generated_at: now,
  };
}
