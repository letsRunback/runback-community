/**
 * Regression-at-scale: diff a candidate eval against a baseline, item by item.
 * A regression (passed in baseline → fails now) is the thing the gate must block;
 * an improvement is the inverse. Joins on item_id, so it holds over large corpora.
 */
import { getAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface RegressionItem { item_id: string; label: string | null }
export interface RegressionReport {
  baselineEvalId: string;
  candidateEvalId: string;
  compared: number;
  regressions: RegressionItem[];
  improvements: RegressionItem[];
  unchanged: number;
  onlyInCandidate: number;
  gatePassed: boolean; // no regressions
}

async function scoresByItem(evalId: string): Promise<Map<string, boolean>> {
  const { data } = await db().from("ad_eval_scores").select("item_id,passed").eq("eval_run_id", evalId);
  const m = new Map<string, boolean>();
  for (const r of (data ?? []) as { item_id: string; passed: boolean }[]) m.set(r.item_id, r.passed);
  return m;
}

export async function diffEvals(baselineEvalId: string, candidateEvalId: string): Promise<RegressionReport> {
  const [base, cand] = await Promise.all([scoresByItem(baselineEvalId), scoresByItem(candidateEvalId)]);

  const ids = [...cand.keys()];
  const labelRows = ids.length
    ? (await db().from("ad_dataset_items").select("id,label").in("id", ids)).data ?? []
    : [];
  const labelOf = new Map((labelRows as { id: string; label: string | null }[]).map((r) => [r.id, r.label]));

  const regressions: RegressionItem[] = [];
  const improvements: RegressionItem[] = [];
  let unchanged = 0, onlyInCandidate = 0, compared = 0;

  for (const [itemId, candPass] of cand) {
    if (!base.has(itemId)) { onlyInCandidate++; continue; }
    compared++;
    const basePass = base.get(itemId)!;
    if (basePass && !candPass) regressions.push({ item_id: itemId, label: labelOf.get(itemId) ?? null });
    else if (!basePass && candPass) improvements.push({ item_id: itemId, label: labelOf.get(itemId) ?? null });
    else unchanged++;
  }

  return {
    baselineEvalId, candidateEvalId, compared,
    regressions, improvements, unchanged, onlyInCandidate,
    gatePassed: regressions.length === 0,
  };
}
