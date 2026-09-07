/**
 * Datasets — named collections of captured LLM steps. Each item snapshots the
 * captured `request` + `model` so the fixture is self-contained and reproducible.
 * Schema: sql/create_eval.sql (ad_datasets / ad_dataset_items, uuid PKs).
 */
import { getAdminClient } from "@/lib/supabase/admin";
import type { LlmEvent } from "@runback/schema";
import type { ScorerConfig } from "./scorers";

export interface DatasetRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  item_count: number;
}

export interface DatasetItemRow {
  id: string;
  dataset_id: string;
  label: string | null;
  source_run_id: string | null;
  source_span_id: string | null;
  request: LlmEvent["request"];
  model: LlmEvent["model"];
  scorers: ScorerConfig[];
  created_at: string;
  /** 'captured' (snapshotted from a real production step) | 'synthetic' (LLM-proposed). */
  source: "captured" | "synthetic";
  /** Meaningful only for synthetic items — null for captured (approval doesn't apply to them). */
  approval_status: "pending" | "approved" | "rejected" | null;
  /** Why the generator proposed this scenario, for a human reviewer. */
  generated_rationale: string | null;
  /** The run whose observed context (system prompt/tools) seeded generation. */
  generated_from_run_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const ITEM_COLS_BASE = "id,dataset_id,label,source_run_id,source_span_id,request,model,scorers,created_at";
// Additive Phase-4 columns (sql/add_adversarial_provenance.sql). Selected as a
// separate, richer query so a database that hasn't run that migration yet
// still serves every pre-existing dataset feature — see fetchItems() below.
const ITEM_COLS_RICH = `${ITEM_COLS_BASE},source,approval_status,generated_rationale,generated_from_run_id,reviewed_by,reviewed_at`;

/** Fill in the Phase-4 provenance fields with their pre-migration defaults. */
function withItemDefaults(row: any): DatasetItemRow {
  return {
    ...row,
    source: row.source ?? "captured",
    approval_status: row.approval_status ?? null,
    generated_rationale: row.generated_rationale ?? null,
    generated_from_run_id: row.generated_from_run_id ?? null,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_at: row.reviewed_at ?? null,
  } as DatasetItemRow;
}

/**
 * Load a dataset's items, tolerant of a database that hasn't applied
 * sql/add_adversarial_provenance.sql yet — falls back to the base columns
 * rather than erroring every dataset page for want of the newest migration.
 */
async function fetchItems(supabase: any, datasetId: string): Promise<DatasetItemRow[]> {
  // Paged rather than unbounded. These items ARE the eval suite: a dataset past
  // PostgREST's 1000-row default silently evaluated a prefix, and the CI gate
  // then reported a pass or fail computed over a subset nobody chose. A gate
  // that quietly stops testing most of the suite is worse than no gate, because
  // it still reports green.
  const PAGE = 1000;
  const MAX = 50_000;

  async function page(cols: string, from: number) {
    return supabase
      .from("ad_dataset_items")
      .select(cols)
      .eq("dataset_id", datasetId)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
  }

  // Probe with the rich column set; fall back to the base set if a migration
  // has not run yet, exactly as before.
  const probe = await page(ITEM_COLS_RICH, 0);
  const cols = probe.error ? ITEM_COLS_BASE : ITEM_COLS_RICH;
  let first = probe;
  if (probe.error) {
    first = await page(ITEM_COLS_BASE, 0);
    if (first.error) throw new Error(first.error.message);
  }

  const out: any[] = [...((first.data ?? []) as any[])];
  if (out.length === PAGE) {
    for (let from = PAGE; from < MAX; from += PAGE) {
      const next = await page(cols, from);
      if (next.error) throw new Error(next.error.message);
      const rows = (next.data ?? []) as any[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out.map(withItemDefaults);
}

/**
 * Resolve a project id (api_keys.id, which doubles as the scope id for runs).
 * Prefers the source run's project; otherwise the most recent run's; otherwise
 * the first API key. Datasets are always built on top of ingested runs, so one
 * of these exists in practice.
 */
export async function resolveProjectId(sourceRunId?: string | null, orgId?: string | null): Promise<string> {
  const supabase = getAdminClient() as any;
  // Every lookup here is org-scoped when an org is known. Unscoped, all three
  // fallbacks reach across tenants: the source run, "the most recent run" and
  // "the first API key" were global, so a dataset could be created against a
  // different customer's project. Run ids being per-tenant makes the first one
  // ambiguous as well — .single() errors once two orgs share an id.
  if (sourceRunId) {
    let q = supabase.from("ad_runs").select("project_id").eq("run_id", sourceRunId);
    if (orgId) q = q.eq("org_id", orgId);
    const { data } = await q.maybeSingle();
    if (data?.project_id) return data.project_id as string;
  }
  let recentQ = supabase
    .from("ad_runs")
    .select("project_id")
    .order("created_at", { ascending: false })
    .limit(1);
  if (orgId) recentQ = recentQ.eq("org_id", orgId);
  const { data: recent } = await recentQ.maybeSingle();
  if (recent?.project_id) return recent.project_id as string;

  let keyQ = supabase
    .from("api_keys")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);
  if (orgId) keyQ = keyQ.eq("org_id", orgId);
  const { data: key } = await keyQ.maybeSingle();
  if (key?.id) return key.id as string;

  throw new Error("No project found — ingest a run or create an API key first.");
}

/** List datasets, newest first, each with its item count. Org-scoped when given. */
export async function listDatasets(orgId?: string | null): Promise<DatasetRow[]> {
  const supabase = getAdminClient() as any;
  let q = supabase
    .from("ad_datasets")
    .select("id,name,description,created_at")
    .order("created_at", { ascending: false });
  if (orgId) q = q.eq("org_id", orgId);
  const { data: datasets, error } = await q;
  if (error) throw new Error(error.message);

  // Scoped to the datasets we just read, and bounded.
  //
  // This selected dataset_id across the WHOLE table, every tenant included, then
  // counted in JS. No data crossed tenants — the counts are keyed back to the
  // caller's own dataset ids — but PostgREST caps an unbounded select at 1000
  // rows, so on any busy deployment other tenants' items consumed the window and
  // item_count silently under-reported, or read zero.
  const ids = ((datasets ?? []) as { id: string }[]).map((d) => d.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: items } = await supabase
      .from("ad_dataset_items")
      .select("dataset_id")
      .in("dataset_id", ids)
      .limit(50_000);
    for (const r of (items ?? []) as { dataset_id: string }[]) {
      counts.set(r.dataset_id, (counts.get(r.dataset_id) ?? 0) + 1);
    }
  }

  return ((datasets ?? []) as Omit<DatasetRow, "item_count">[]).map((d) => ({
    ...d,
    item_count: counts.get(d.id) ?? 0,
  }));
}

/**
 * Load one dataset with its items, or null if it doesn't exist — or if it belongs
 * to a DIFFERENT org than the caller. `orgId` scopes access: an org-owned dataset
 * is only returned to that org; null-org (demo/legacy) datasets stay open. Pass the
 * caller's session org to enforce tenant isolation.
 */
export async function getDataset(
  datasetId: string,
  orgId?: string | null
): Promise<{ dataset: Omit<DatasetRow, "item_count">; items: DatasetItemRow[] } | null> {
  const supabase = getAdminClient() as any;
  const { data: dataset } = await supabase
    .from("ad_datasets")
    .select("id,name,description,created_at,org_id")
    .eq("id", datasetId)
    .single();
  if (!dataset) return null;
  // Tenant isolation: an org-owned dataset is invisible to a different org.
  // Fail closed on a null-org row: `org_id && …` left an unowned dataset
  // readable by anyone (the public route passes null). Same class as the run
  // guard fixed earlier — require a real, matching org.
  if (!dataset.org_id || dataset.org_id !== orgId) return null;

  const items = await fetchItems(supabase, datasetId);
  return { dataset, items };
}

export async function createDataset(input: {
  name: string;
  description?: string | null;
  source_run_id?: string | null;
  org_id?: string | null;
}): Promise<Omit<DatasetRow, "item_count">> {
  const supabase = getAdminClient() as any;
  // Prefer the org's own key as the project scope; fall back to the global resolver.
  let project_id: string | undefined;
  if (input.org_id) {
    const { data: k } = await supabase.from("api_keys").select("id").eq("org_id", input.org_id).limit(1).maybeSingle();
    project_id = k?.id;
  }
  if (!project_id) project_id = await resolveProjectId(input.source_run_id, input.org_id);
  const { data, error } = await supabase
    .from("ad_datasets")
    .insert({ project_id, org_id: input.org_id ?? null, name: input.name, description: input.description ?? null })
    .select("id,name,description,created_at")
    .single();
  if (error) throw new Error(error.message);
  return data as Omit<DatasetRow, "item_count">;
}

/** Snapshot a captured step's request + model into a dataset as a new item. */
export async function addItem(input: {
  dataset_id: string;
  label: string;
  request: LlmEvent["request"];
  model: LlmEvent["model"];
  scorers: ScorerConfig[];
  source_run_id?: string | null;
  source_span_id?: string | null;
}): Promise<DatasetItemRow> {
  const supabase = getAdminClient() as any;
  const { data, error } = await supabase
    .from("ad_dataset_items")
    .insert({
      dataset_id: input.dataset_id,
      label: input.label,
      request: input.request,
      model: input.model,
      scorers: input.scorers,
      source_run_id: input.source_run_id ?? null,
      source_span_id: input.source_span_id ?? null,
    })
    .select("id,dataset_id,label,source_run_id,source_span_id,request,model,scorers,created_at")
    .single();
  if (error) throw new Error(error.message);
  return withItemDefaults(data);
}

/**
 * Insert an LLM-PROPOSED scenario as a dataset item. Distinct from addItem in
 * one crucial way: it is never trusted by default. It lands with
 * `source: "synthetic"`, `approval_status: "pending"` and is excluded from
 * gating_pass_rate (see web/lib/eval/runner.ts) until reviewSyntheticItem()
 * marks it approved. Requires sql/add_adversarial_provenance.sql — the insert
 * fails on a database that hasn't run it, which is the correct behavior (the
 * feature genuinely can't work without the schema).
 */
export async function addSyntheticItem(input: {
  dataset_id: string;
  label: string;
  request: LlmEvent["request"];
  model: LlmEvent["model"];
  scorers: ScorerConfig[];
  generated_rationale: string;
  generated_from_run_id?: string | null;
}): Promise<DatasetItemRow> {
  const supabase = getAdminClient() as any;
  const { data, error } = await supabase
    .from("ad_dataset_items")
    .insert({
      dataset_id: input.dataset_id,
      label: input.label,
      request: input.request,
      model: input.model,
      scorers: input.scorers,
      source: "synthetic",
      approval_status: "pending",
      generated_rationale: input.generated_rationale,
      generated_from_run_id: input.generated_from_run_id ?? null,
    })
    .select(ITEM_COLS_RICH)
    .single();
  if (error) throw new Error(error.message);
  return withItemDefaults(data);
}

/**
 * A human reviews a proposed scenario. Only a synthetic, pending item can be
 * reviewed — approving/rejecting anything else is a no-op that returns false,
 * so a caller can distinguish "reviewed" from "nothing to review".
 */
export async function reviewSyntheticItem(
  itemId: string,
  datasetId: string,
  decision: "approved" | "rejected",
  reviewerEmail: string
): Promise<boolean> {
  const supabase = getAdminClient() as any;
  const { data, error } = await supabase
    .from("ad_dataset_items")
    .update({ approval_status: decision, reviewed_by: reviewerEmail, reviewed_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("dataset_id", datasetId)
    .eq("source", "synthetic")
    .eq("approval_status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/**
 * Load a captured LLM step from a run, for snapshotting into a dataset. `orgId`
 * scopes access: a step from an org-owned run is only readable by that org (so one
 * tenant can't snapshot another's captured requests); null-org runs stay open.
 */
export async function loadCapturedStep(
  runId: string,
  spanId: string,
  orgId?: string | null
): Promise<LlmEvent | null> {
  const supabase = getAdminClient() as any;
  // Tenant isolation by filter rather than fetch-then-compare: run ids are
  // unique per org now, so matching on run_id alone can return a different
  // tenant's row — or error in maybeSingle() when two orgs share the id.
  if (!orgId) return null;
  const { data: run } = await supabase.from("ad_runs").select("run_id")
    .eq("org_id", orgId).eq("run_id", runId).maybeSingle();
  if (!run) return null;

  const { data: row } = await supabase
    .from("ad_events")
    .select("data")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .eq("span_id", spanId)
    .maybeSingle();
  if (!row) return null;
  const event = row.data as LlmEvent;
  return event.type === "llm" ? event : null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
