/**
 * Evals — one scored run of a dataset (ad_eval_runs) plus per-item scores
 * (ad_eval_scores). Creating an eval persists the envelope; the runner
 * (./runner) fills in the scores and the aggregate pass counts.
 * Schema: sql/create_eval.sql.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import type { ScoreResult, ReplayedOutput } from "./scorers";

export interface EvalRow {
  id: string;
  dataset_id: string;
  name: string | null;
  model_id: string | null;
  status: "running" | "done" | "error";
  total: number;
  passed: number;
  pass_rate: number | null;
  created_at: string;
  ended_at: string | null;
  /** Joined for list/detail views. */
  dataset_name?: string;
}

export interface EvalScoreRow {
  item_id: string;
  passed: boolean;
  results: ScoreResult[];
  output: ReplayedOutput | null;
  created_at: string;
  /** Joined from the dataset item. */
  label: string | null;
}

const EVAL_COLS =
  "id,dataset_id,name,model_id,status,total,passed,pass_rate,created_at,ended_at";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Create the eval envelope (status=running). The runner finishes it. */
export async function createEval(input: {
  dataset_id: string;
  name: string;
  model_id?: string | null;
  policy_id?: string | null;
}): Promise<EvalRow> {
  const supabase = getAdminClient() as any;

  const { data: ds } = await supabase
    .from("ad_datasets")
    .select("project_id, org_id, baseline_eval_id")
    .eq("id", input.dataset_id)
    .single();
  if (!ds?.project_id) throw new Error("Dataset not found");

  const { data, error } = await supabase
    .from("ad_eval_runs")
    .insert({
      project_id: ds.project_id,
      org_id: ds.org_id ?? null,
      dataset_id: input.dataset_id,
      name: input.name,
      model_id: input.model_id ?? null,
      policy_id: input.policy_id ?? null,
      baseline_eval_id: ds.baseline_eval_id ?? null,
    })
    .select(EVAL_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as EvalRow;
}

async function datasetNameMap(): Promise<Map<string, string>> {
  const supabase = getAdminClient() as any;
  const { data } = await supabase.from("ad_datasets").select("id,name");
  const names = new Map<string, string>();
  for (const d of (data ?? []) as { id: string; name: string }[]) names.set(d.id, d.name);
  return names;
}

/** List evals, newest first, with their dataset name. Org-scoped when given. */
export async function listEvals(orgId?: string | null): Promise<EvalRow[]> {
  const supabase = getAdminClient() as any;
  let q = supabase
    .from("ad_eval_runs")
    .select(EVAL_COLS)
    .order("created_at", { ascending: false });
  if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const names = await datasetNameMap();
  return ((data ?? []) as EvalRow[]).map((e) => ({ ...e, dataset_name: names.get(e.dataset_id) }));
}

/** List the evals run against one dataset. */
export async function listEvalsForDataset(datasetId: string): Promise<EvalRow[]> {
  const supabase = getAdminClient() as any;
  const { data, error } = await supabase
    .from("ad_eval_runs")
    .select(EVAL_COLS)
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as EvalRow[];
}

/**
 * Load one eval with its scored results (each labelled from its dataset item), or
 * null if it doesn't exist — or belongs to a different org than the caller. Pass
 * the session org to enforce tenant isolation (null-org evals stay open).
 */
export async function getEval(
  evalId: string,
  orgId?: string | null
): Promise<{ eval: EvalRow; results: EvalScoreRow[] } | null> {
  const supabase = getAdminClient() as any;
  const { data: ev } = await supabase
    .from("ad_eval_runs")
    .select(`${EVAL_COLS},org_id`)
    .eq("id", evalId)
    .single();
  if (!ev) return null;
  // Fail closed on a null-org row — same class as getDataset and the run guard.
  if (!ev.org_id || ev.org_id !== orgId) return null;
  const evalRun = ev as EvalRow;

  const { data: ds } = await supabase
    .from("ad_datasets")
    .select("name")
    .eq("id", evalRun.dataset_id)
    .single();

  const { data: items } = await supabase
    .from("ad_dataset_items")
    .select("id,label")
    .eq("dataset_id", evalRun.dataset_id);
  const labels = new Map<string, string | null>();
  for (const it of (items ?? []) as { id: string; label: string | null }[]) {
    labels.set(it.id, it.label);
  }

  const { data: scores, error } = await supabase
    .from("ad_eval_scores")
    .select("item_id,passed,results,output,created_at")
    .eq("eval_run_id", evalId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const results = ((scores ?? []) as Omit<EvalScoreRow, "label">[]).map((s) => ({
    ...s,
    label: labels.get(s.item_id) ?? null,
  }));

  return { eval: { ...evalRun, dataset_name: (ds as { name?: string } | null)?.name }, results };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
