/**
 * Ties an eval suite's result to a release decision — the missing piece
 * flagged against Direction 2 (adversarial tests): "no versioned,
 * release-blocking pass-rate threshold ties an eval suite's result to a
 * deploy decision." This reuses upgradeGate.ts's per-org versioned threshold
 * (the same one Models > Gate checks) rather than inventing a second one.
 *
 * The pass rate checked here is gating_pass_rate (runner.ts) — computed from
 * TRUSTED items only: production-captured, or synthetic scenarios a human has
 * explicitly approved (datasets.ts reviewSyntheticItem). A pending or
 * rejected synthetic scenario is scored for review but never moves this
 * number, so an unreviewed LLM-proposed test can never itself block or pass a
 * release.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { verdictFor, getOrgGateThresholds, type UpgradeGateReport } from "@/lib/upgradeGate";

/** Same predicate as runner.ts's isTrustedForGating, inlined: that one takes
 *  the full ItemRow shape (not exported) runner.ts builds internally, while
 *  this call site only ever has the two provenance fields from a join. */
function trustedForGating(source: string | null | undefined, approvalStatus: string | null | undefined): boolean {
  return source !== "synthetic" || approvalStatus === "approved";
}

export interface EvalGateReport {
  eval_id: string;
  dataset_id: string;
  dataset_name: string | null;
  /** Items counted toward the verdict (captured + approved-synthetic only). */
  total: number;
  passed: number;
  pass_rate: number;
  pass_threshold: number;
  warn_threshold: number;
  verdict: UpgradeGateReport["verdict"];
  /** Scored items that exist but were excluded (pending/rejected synthetic) — visible so "0 total" reads as "nothing trusted yet", not "no items". */
  excluded_from_gating: number;
  /**
   * The single aggregate pass_rate above can't say WHERE a regression is
   * concentrated. Split by provenance so "which category actually moved" is
   * visible instead of collapsed into one number — a run failing entirely on
   * newly-approved adversarial-mined items reads very differently from one
   * failing on its long-standing captured corpus, even at the same overall
   * pass rate. Null if the per-item join can't be computed (pre-migration DB).
   */
  by_source: { captured: { total: number; passed: number }; synthetic_approved: { total: number; passed: number } } | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Compute the release-gate verdict for a finished eval. Returns null if the
 * eval doesn't exist, isn't the caller's org, hasn't finished, or the
 * database hasn't applied sql/add_adversarial_provenance.sql yet (the
 * gating_* columns won't exist to select — a clear "not available" rather
 * than a silently wrong number).
 */
export async function gateEvalSuite(orgId: string, evalId: string): Promise<EvalGateReport | null> {
  const sb = getAdminClient() as any;
  const { data: ev, error } = await sb
    .from("ad_eval_runs")
    .select("id,dataset_id,org_id,status,total,gating_total,gating_passed")
    .eq("id", evalId)
    .maybeSingle();
  if (error || !ev) return null;
  // Fail CLOSED on a null org_id, not open: ad_eval_runs.org_id was added by
  // sql/create_eval_tenancy.sql with no backfill/NOT NULL, so a pre-migration
  // (or otherwise unbackfilled) row can legitimately have org_id = NULL. The
  // old `ev.org_id && ev.org_id !== orgId` check made that NULL case bypass
  // the ownership check entirely — any authenticated caller in any org could
  // read another org's eval-gate verdict (dataset name, pass/fail counts,
  // release decision) just by guessing/enumerating its eval_id. Same pattern
  // already fixed in runs/[run_id]/bisect, reexecute, audit, and datasets.ts.
  if (!ev.org_id || ev.org_id !== orgId) return null;
  if (ev.status !== "done") return null;
  if (ev.gating_total == null || ev.gating_passed == null) return null; // pre-migration DB, or eval never re-scored since

  const total = ev.gating_total as number;
  const passed = ev.gating_passed as number;
  const passRate = total > 0 ? passed / total : 0;

  const { passThreshold, warnThreshold } = await getOrgGateThresholds(orgId);
  const verdict = verdictFor(passRate, passThreshold, warnThreshold, total);

  const { data: ds } = await sb.from("ad_datasets").select("name").eq("id", ev.dataset_id).maybeSingle();

  // Best-effort per-provenance breakdown: same join used for review elsewhere
  // (item source/approval_status). Never lets a join failure (e.g. a
  // pre-migration DB without the provenance columns) break the gate verdict
  // itself — by_source degrades to null, the pass/fail decision above doesn't.
  let bySource: EvalGateReport["by_source"] = null;
  try {
    const { data: scored, error: scoredErr } = await sb
      .from("ad_eval_scores")
      .select("passed, ad_dataset_items(source, approval_status)")
      .eq("eval_run_id", evalId);
    if (!scoredErr && scored) {
      const captured = { total: 0, passed: 0 };
      const syntheticApproved = { total: 0, passed: 0 };
      for (const row of scored as { passed: boolean; ad_dataset_items: { source: string | null; approval_status: string | null } | null }[]) {
        const item = row.ad_dataset_items;
        if (!item || !trustedForGating(item.source, item.approval_status)) continue;
        const bucket = item.source === "synthetic" ? syntheticApproved : captured;
        bucket.total++;
        if (row.passed) bucket.passed++;
      }
      bySource = { captured, synthetic_approved: syntheticApproved };
    }
  } catch { /* join unavailable — by_source stays null, verdict above is unaffected */ }

  return {
    eval_id: ev.id,
    dataset_id: ev.dataset_id,
    dataset_name: ds?.name ?? null,
    total,
    passed,
    pass_rate: passRate,
    pass_threshold: passThreshold,
    warn_threshold: warnThreshold,
    verdict,
    excluded_from_gating: Math.max(0, (ev.total ?? 0) - total),
    by_source: bySource,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
