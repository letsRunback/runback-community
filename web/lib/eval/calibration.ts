/**
 * Judge calibration ("align evals") — a human reviews real (non-demo)
 * LLM-judge verdicts and corrects the ones it got wrong. Corrections are fed
 * back as few-shot examples into future judge prompts for the SAME rubric
 * (joined by rubricHash, not by dataset — a rubric used across many datasets
 * shares one calibration pool). Schema: sql/create_judge_calibration.sql.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import type { AuditActor } from "@/lib/adminAudit";
import type { JudgeFewShotExample } from "./judge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface JudgeReviewRow {
  id: string;
  eval_run_id: string;
  item_id: string;
  rubric_hash: string;
  rubric_label: string | null;
  judge_passed: boolean;
  judge_score: number | null;
  judge_reason: string | null;
  output_snippet: string | null;
  human_passed: boolean | null;
  human_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const OUTPUT_SNIPPET_MAX = 500;

/**
 * Record one judge verdict for possible later human review. Best-effort: this
 * runs inline in the eval runner's hot path, and a review row existing is
 * never load-bearing for the eval itself — a failed insert (e.g. the org's DB
 * hasn't applied this migration yet) must never fail the eval.
 */
export async function recordJudgeReview(input: {
  orgId: string;
  evalRunId: string;
  itemId: string;
  rubricHash: string;
  rubricLabel?: string | null;
  judgePassed: boolean;
  judgeScore: number | null;
  judgeReason: string | null;
  output: string | null;
  /** Which model actually produced this verdict (judge.ts's pickJudgeModel) —
   *  see sql/add_judge_model.sql for why this exists. */
  judgeModel?: string | null;
}): Promise<void> {
  try {
    await db().from("ad_judge_reviews").upsert(
      {
        org_id: input.orgId,
        eval_run_id: input.evalRunId,
        item_id: input.itemId,
        rubric_hash: input.rubricHash,
        rubric_label: input.rubricLabel ?? null,
        judge_passed: input.judgePassed,
        judge_score: input.judgeScore,
        judge_reason: input.judgeReason,
        output_snippet: input.output?.slice(0, OUTPUT_SNIPPET_MAX) ?? null,
        judge_model: input.judgeModel ?? null,
      },
      { onConflict: "eval_run_id,item_id,rubric_hash" }
    );
  } catch (e) {
    console.error("[calibration] recordJudgeReview failed (non-fatal):", e);
  }
}

/** Pending (not yet human-reviewed) verdicts for a rubric, oldest first. */
export async function listReviews(orgId: string, rubricHash: string, opts: { pendingOnly?: boolean } = {}): Promise<JudgeReviewRow[]> {
  let q = db().from("ad_judge_reviews").select("*").eq("org_id", orgId).eq("rubric_hash", rubricHash);
  if (opts.pendingOnly) q = q.is("human_passed", null);
  const { data } = await q.order("created_at", { ascending: true }).limit(200);
  return (data ?? []) as JudgeReviewRow[];
}

/** Every distinct rubric this org has judge-review history for, most recent first. */
export async function listRubrics(orgId: string): Promise<{ rubricHash: string; rubricLabel: string | null; pending: number; total: number }[]> {
  const { data } = await db().from("ad_judge_reviews").select("rubric_hash,rubric_label,human_passed").eq("org_id", orgId);
  const rows = (data ?? []) as { rubric_hash: string; rubric_label: string | null; human_passed: boolean | null }[];
  const byHash = new Map<string, { rubricHash: string; rubricLabel: string | null; pending: number; total: number }>();
  for (const r of rows) {
    const entry = byHash.get(r.rubric_hash) ?? { rubricHash: r.rubric_hash, rubricLabel: r.rubric_label, pending: 0, total: 0 };
    entry.total++;
    if (r.human_passed === null) entry.pending++;
    if (r.rubric_label) entry.rubricLabel = r.rubric_label;
    byHash.set(r.rubric_hash, entry);
  }
  return [...byHash.values()].sort((a, b) => b.pending - a.pending);
}

/** A human agrees or corrects one judge verdict. */
export async function submitReview(
  orgId: string,
  reviewId: string,
  humanPassed: boolean,
  reviewedBy: string,
  humanNote?: string | null,
  actor?: AuditActor
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await db()
    .from("ad_judge_reviews")
    .update({ human_passed: humanPassed, human_note: humanNote ?? null, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq("id", reviewId)
    .eq("org_id", orgId)
    .select("id,judge_passed,rubric_hash")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Review not found." };

  // Correcting the judge is a governance-adjacent action — audited the same
  // way a policy edit or a pairwise human override is.
  const { logAdminAction } = await import("@/lib/adminAudit");
  await logAdminAction({
    orgId,
    actor,
    action: "eval.judge_calibrate",
    targetType: "judge_review",
    targetId: reviewId,
    metadata: { rubric_hash: data.rubric_hash, judge_passed: data.judge_passed, human_passed: humanPassed, corrected: data.judge_passed !== humanPassed },
  });

  return { ok: true };
}

export interface AlignmentReport {
  reviewed: number;
  agreed: number;
  /** Simple % agreement between judge and human — NOT Cohen's kappa; this field is not
   *  used in the field's actual practice, so don't compute for an unused metric. */
  agreementPct: number;
}

/** Simple agreement rate between the judge and human review, over reviewed items only. */
export async function alignmentScore(orgId: string, rubricHash: string): Promise<AlignmentReport> {
  const { data } = await db()
    .from("ad_judge_reviews")
    .select("judge_passed,human_passed")
    .eq("org_id", orgId)
    .eq("rubric_hash", rubricHash)
    .not("human_passed", "is", null);
  const rows = (data ?? []) as { judge_passed: boolean; human_passed: boolean }[];
  const reviewed = rows.length;
  const agreed = rows.filter((r) => r.judge_passed === r.human_passed).length;
  return { reviewed, agreed, agreementPct: reviewed ? Math.round((agreed / reviewed) * 1000) / 10 : 0 };
}

/**
 * The most recent human corrections for a rubric — fed back into future judge
 * prompts as few-shot examples (lib/eval/judge.ts's `fewShot` param). Only
 * corrections (judge and human disagreed) are useful signal; an agreement adds
 * nothing the judge didn't already know.
 */
/**
 * @param currentJudgeModel The model that will actually grade THIS call (judge.ts's
 *   pickJudgeModel, resolved by the caller before this runs). When given, corrections
 *   recorded under a DIFFERENTLY-IDENTIFIED judge model are excluded — a silent
 *   provider checkpoint swap (or an org switching BYOK providers) must not keep
 *   applying corrections gathered under a judge that may no longer behave the same
 *   way, with nothing surfacing that the swap happened. Rows with no judge_model at
 *   all (recorded before sql/add_judge_model.sql) are treated as "unknown, still
 *   usable" rather than discarded — there is no evidence of a mismatch, only an
 *   absence of the check, and reviewers' past explicit corrections are a rarer and
 *   more valuable signal than a single, possibly-innocent identity gap.
 */
export async function getFewShotExamples(
  orgId: string,
  rubricHash: string,
  limit = 3,
  currentJudgeModel?: string
): Promise<JudgeFewShotExample[]> {
  const { data } = await db()
    .from("ad_judge_reviews")
    .select("output_snippet,judge_passed,human_passed,human_note,reviewed_at,judge_model")
    .eq("org_id", orgId)
    .eq("rubric_hash", rubricHash)
    .not("human_passed", "is", null)
    .order("reviewed_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as { output_snippet: string | null; judge_passed: boolean; human_passed: boolean; human_note: string | null; reviewed_at: string; judge_model: string | null }[];
  return rows
    // Only actual CORRECTIONS are useful few-shot signal — an agreement tells
    // the judge nothing it didn't already conclude on its own. Without this
    // filter, a run of recent agreements could push real corrections out of
    // the window entirely and silently break the feedback loop.
    .filter((r) => r.output_snippet && r.judge_passed !== r.human_passed)
    .filter((r) => !currentJudgeModel || !r.judge_model || r.judge_model === currentJudgeModel)
    .slice(0, limit)
    .map((r) => ({
      output: r.output_snippet as string,
      passed: r.human_passed,
      reason: r.human_note?.trim() || `Human reviewer corrected the judge — this should have been graded ${r.human_passed ? "PASS" : "FAIL"}.`,
    }));
}
