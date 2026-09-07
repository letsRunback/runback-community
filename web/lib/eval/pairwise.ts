/**
 * Pairwise comparison — is candidate output A or B better for the SAME input,
 * per item, rather than two independent pass/fail scores (lib/eval/regression.ts's
 * diffEvals). A comparison has no envelope row of its own: it's just two
 * existing ad_eval_runs ids, the same way diffEvals already treats a
 * baseline/candidate pair. Schema: sql/create_pairwise.sql.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getOrgKeys } from "@/lib/modelKeys";
import { runPairwiseJudge, pickJudgeModel, type PairwiseSide } from "./judge";
import { inputTextOf } from "./policy";
import { demoHash } from "./demoHash";
import type { ReplayedOutput } from "./scorers";
import type { AuditActor } from "@/lib/adminAudit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface PairwiseItemView {
  item_id: string;
  label: string | null;
  outputA: string | null;
  outputB: string | null;
  winner: PairwiseSide | null;
  reason: string | null;
  source: "llm" | "human" | null;
  /** True when the judge model is the SAME model that produced side A or B —
   *  a known LLM-judge self-preference bias. Not blocked, only surfaced. */
  judgeIsCandidate: boolean;
}

export interface PairwiseSummary {
  compared: number;
  aWins: number;
  bWins: number;
  ties: number;
  aWinPct: number;
  bWinPct: number;
  tiePct: number;
  /** How many of `compared` had the judge grading a side IT produced — a
   *  known bias risk, surfaced rather than hidden inside the win/tie counts. */
  selfJudged: number;
}

async function scoredOutputsByItem(evalRunId: string): Promise<Map<string, string | null>> {
  const { data } = await db().from("ad_eval_scores").select("item_id,output").eq("eval_run_id", evalRunId);
  const m = new Map<string, string | null>();
  for (const r of (data ?? []) as { item_id: string; output: ReplayedOutput | null }[]) {
    m.set(r.item_id, r.output?.text ?? null);
  }
  return m;
}

/**
 * Judge every item present in both eval runs that hasn't been compared for
 * this exact pair yet — safe to call again later (e.g. after new items were
 * added to the dataset) without re-spending tokens on ones already verdicted.
 * Zero-cost/simulated in demo mode, same convention as runner.ts's llm_judge
 * branch: a stable hash-based verdict, clearly labelled, no model call.
 */
export async function comparePairwise(
  orgId: string,
  evalRunAId: string,
  evalRunBId: string,
  opts: { demo?: boolean; randomizeOrder?: boolean } = {}
): Promise<{ judged: number; skipped: number; failed: number; compared: number }> {
  const [outputsA, outputsB] = await Promise.all([
    scoredOutputsByItem(evalRunAId),
    scoredOutputsByItem(evalRunBId),
  ]);
  const itemIds = [...outputsA.keys()].filter((id) => outputsB.has(id));
  if (!itemIds.length) return { judged: 0, skipped: 0, failed: 0, compared: 0 };

  const { data: existing } = await db()
    .from("ad_pairwise_verdicts")
    .select("item_id")
    .eq("eval_run_a_id", evalRunAId)
    .eq("eval_run_b_id", evalRunBId)
    .in("item_id", itemIds);
  const already = new Set((existing ?? []).map((r: { item_id: string }) => r.item_id));
  const todo = itemIds.filter((id) => !already.has(id));
  if (!todo.length) return { judged: 0, skipped: already.size, failed: 0, compared: itemIds.length };

  const { data: items } = await db().from("ad_dataset_items").select("id,request").in("id", todo);
  const requestById = new Map(((items ?? []) as { id: string; request: unknown }[]).map((r) => [r.id, r.request]));

  const demo = opts.demo ?? false;
  const keys = demo ? undefined : await getOrgKeys(orgId);
  const randomizeOrder = opts.randomizeOrder ?? true;

  // Self-preference check: which model actually produced each side. Fetched
  // once per pair (model_id is per-run, not per-item), compared against the
  // judge model resolved for THIS pairwise judge call — same fixed model on
  // every item here, since pickJudgeModel's inputs (keys, env) don't vary
  // per-item within one comparePairwise() call.
  let judgeIsCandidate = false;
  if (!demo) {
    const { data: runRows } = await db()
      .from("ad_eval_runs")
      .select("id,model_id")
      .in("id", [evalRunAId, evalRunBId]);
    const modelById = new Map(((runRows ?? []) as { id: string; model_id: string | null }[]).map((r) => [r.id, r.model_id]));
    const judgeModelId = pickJudgeModel(keys);
    judgeIsCandidate = judgeModelId === modelById.get(evalRunAId) || judgeModelId === modelById.get(evalRunBId);
  }

  let judged = 0;
  let failed = 0;
  // Sequential, matching runner.ts's item loop — one model call at a time
  // rather than a thundering herd against the provider's rate limits.
  for (const itemId of todo) {
    const outputA = outputsA.get(itemId) ?? null;
    const outputB = outputsB.get(itemId) ?? null;
    let winner: PairwiseSide;
    let reason: string;
    let randomized: boolean;

    if (demo) {
      const h = demoHash(itemId + ":pairwise") % 100;
      winner = h < 40 ? "a" : h < 80 ? "b" : "tie";
      reason = "demo — simulated judge, no model call";
      randomized = false;
    } else {
      const input = inputTextOf(requestById.get(itemId));
      const v = await runPairwiseJudge({ input, outputA, outputB, keys, randomizeOrder });
      if (!v.ok) {
        // The judge never ran (no key, provider outage) — this is not a
        // verdict. Leave the item un-verdicted so it stays in `todo` and gets
        // picked up by the next comparePairwise call, instead of writing a
        // fake "tie" that permanently pollutes summarizePairwise's stats.
        failed++;
        continue;
      }
      winner = v.winner;
      reason = v.reason;
      randomized = v.randomized;
    }

    const verdictRow = {
      org_id: orgId, eval_run_a_id: evalRunAId, eval_run_b_id: evalRunBId, item_id: itemId,
      winner, reason, source: "llm", randomized, judge_is_candidate: judgeIsCandidate, updated_at: new Date().toISOString(),
    };
    let { error } = await db().from("ad_pairwise_verdicts").upsert(verdictRow, { onConflict: "eval_run_a_id,eval_run_b_id,item_id" });
    // Tolerant of a database that hasn't applied
    // sql/add_pairwise_self_preference_flag.sql yet — same "an additive column
    // missing must never break the write it's riding on" pattern used
    // throughout this codebase (e.g. runner.ts's gating_total write). Retry
    // once without the new field rather than losing the verdict entirely.
    if (error && /judge_is_candidate/.test(error.message)) {
      const { judge_is_candidate: _judgeIsCandidate, ...legacyRow } = verdictRow;
      ({ error } = await db().from("ad_pairwise_verdicts").upsert(legacyRow, { onConflict: "eval_run_a_id,eval_run_b_id,item_id" }));
    }
    // A judged-but-unwritten verdict must not count as judged, or the caller
    // (and the UI) reports success for a comparison nothing was ever
    // persisted for — the exact "ignored `error`" failure class this
    // schema (create_pairwise.sql) exists to avoid repeating.
    if (error) {
      console.error("comparePairwise: verdict write failed", { itemId, error: error.message });
      failed++;
      continue;
    }
    judged++;
  }

  return { judged, skipped: already.size, failed, compared: itemIds.length };
}

/** A human overrides (or sets, if none exists) the verdict for one item. */
export async function setHumanVerdict(
  orgId: string,
  evalRunAId: string,
  evalRunBId: string,
  itemId: string,
  winner: PairwiseSide,
  actor?: AuditActor
): Promise<void> {
  const { error } = await db().from("ad_pairwise_verdicts").upsert(
    {
      org_id: orgId, eval_run_a_id: evalRunAId, eval_run_b_id: evalRunBId, item_id: itemId,
      winner, source: "human", updated_at: new Date().toISOString(),
    },
    { onConflict: "eval_run_a_id,eval_run_b_id,item_id" }
  );
  if (error) throw new Error("Could not save the override — try again.");

  // A human overriding an AI verdict is a governance-adjacent action of the
  // same shape as a policy edit — audited the same way.
  const { logAdminAction } = await import("@/lib/adminAudit");
  await logAdminAction({
    orgId,
    actor,
    action: "eval.pairwise_override",
    targetType: "eval_run_pair",
    targetId: `${evalRunAId}:${evalRunBId}`,
    metadata: { item_id: itemId, winner },
  });
}

export async function summarizePairwise(evalRunAId: string, evalRunBId: string): Promise<PairwiseSummary> {
  const { data } = await db()
    .from("ad_pairwise_verdicts")
    .select("winner,judge_is_candidate")
    .eq("eval_run_a_id", evalRunAId)
    .eq("eval_run_b_id", evalRunBId);
  const rows = (data ?? []) as { winner: PairwiseSide; judge_is_candidate: boolean | null }[];
  const compared = rows.length;
  const aWins = rows.filter((r) => r.winner === "a").length;
  const bWins = rows.filter((r) => r.winner === "b").length;
  const ties = compared - aWins - bWins;
  const selfJudged = rows.filter((r) => r.judge_is_candidate).length;
  const pct = (n: number) => (compared ? Math.round((n / compared) * 1000) / 10 : 0);
  return { compared, aWins, bWins, ties, aWinPct: pct(aWins), bWinPct: pct(bWins), tiePct: pct(ties), selfJudged };
}

export async function listPairwiseItems(evalRunAId: string, evalRunBId: string): Promise<PairwiseItemView[]> {
  const [outputsA, outputsB, verdictsRes] = await Promise.all([
    scoredOutputsByItem(evalRunAId),
    scoredOutputsByItem(evalRunBId),
    db().from("ad_pairwise_verdicts").select("item_id,winner,reason,source,judge_is_candidate")
      .eq("eval_run_a_id", evalRunAId).eq("eval_run_b_id", evalRunBId),
  ]);
  type VerdictRow = { item_id: string; winner: PairwiseSide; reason: string | null; source: "llm" | "human"; judge_is_candidate: boolean | null };
  const verdictByItem = new Map(((verdictsRes.data ?? []) as VerdictRow[]).map((v) => [v.item_id, v]));

  const itemIds = [...outputsA.keys()].filter((id) => outputsB.has(id));
  if (!itemIds.length) return [];
  const { data: items } = await db().from("ad_dataset_items").select("id,label").in("id", itemIds);
  const labelById = new Map(((items ?? []) as { id: string; label: string | null }[]).map((r) => [r.id, r.label]));

  return itemIds.map((item_id) => {
    const v = verdictByItem.get(item_id);
    return {
      item_id,
      label: labelById.get(item_id) ?? null,
      outputA: outputsA.get(item_id) ?? null,
      outputB: outputsB.get(item_id) ?? null,
      winner: v?.winner ?? null,
      reason: v?.reason ?? null,
      source: v?.source ?? null,
      judgeIsCandidate: v?.judge_is_candidate ?? false,
    };
  });
}
