import { getAdminClient } from "@/lib/supabase/admin";
import { getTenantClient } from "@/lib/supabase/tenant";
import type { TraceEvent } from "@runback/schema";

/**
 * The org-scoped client when we know the tenant, the admin client when we do
 * not.
 *
 * Reads with an org go through a database role that cannot bypass RLS, so the
 * policies filter by tenant whether or not this file's own `.eq("org_id", …)`
 * is present. Those filters stay: they are correct anyway, they keep the query
 * plan tight, and they are the only protection on a deployment where the tenant
 * role has not been configured yet.
 *
 * Callers with no org — cron sweeps, ingest resolving a key — legitimately need
 * the unrestricted client, and get it here rather than by reaching for it.
 */
function scopedClient(orgId?: string | null) {
  return orgId ? getTenantClient(orgId).client : getAdminClient();
}

/** A single run's event ceiling. Generous; exists so truncation is explicit. */
const MAX_EVENTS_PER_RUN = 20_000;

export interface RunRow {
  run_id: string;
  name: string;
  status: "running" | "success" | "error";
  input: unknown;
  output: unknown;
  error: unknown;
  metadata: Record<string, unknown>;
  step_count: number;
  total_tokens: number;
  started_at: string;
  ended_at: string | null;
  /** Who/what drove this run — self-reported by the SDK (CollectorOptions.actor). Null when the integrator didn't set one. */
  actor_type: "user" | "api_key" | "system" | null;
  actor_id: string | null;
}

/**
 * List runs, newest first.
 *
 * Reads through the org-scoped client when one is given, so the database
 * filters by tenant regardless of what this function does. The `.eq("org_id")`
 * below stays: it is the correct query either way, and it is what protects
 * deployments where the tenant role is not yet configured.
 */
export async function listRuns(limit = 50, orgId?: string | null): Promise<RunRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = scopedClient(orgId) as any;
  let q = supabase
    .from("ad_runs")
    .select(
      "run_id,name,status,input,output,error,metadata,step_count,total_tokens,started_at,ended_at,actor_type,actor_id"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  // Tenant isolation: when an org is given, only that org's runs.
  if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as RunRow[];
}

/**
 * How many runs this org has ever captured.
 *
 * The signal for "this workspace is empty" rather than "these numbers are
 * genuinely zero". /app/benchmark, /app/regulatory and /app/compliance all
 * computed a full report against no data and rendered it — percentile cards,
 * compliance statuses and KPI tiles all reading 0 — which is indistinguishable
 * from a real workspace performing badly. An org that has captured nothing
 * should be told what to do next, not shown a scorecard of zeros.
 */
export async function countRuns(orgId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = scopedClient(orgId) as any;
  const { count, error } = await supabase
    .from("ad_runs")
    .select("run_id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (error) {
    console.error("[runs] countRuns failed:", error.message);
    // Fail toward showing the report rather than wrongly claiming "no data".
    return -1;
  }
  return count ?? 0;
}

/**
 * Load a run envelope plus its full ordered event stream.
 *
 * Pass `orgId` to scope the lookup to one tenant — any authenticated, user-facing
 * caller MUST do this so a run id from another org returns null instead of leaking
 * across tenants. Omit it only for intentionally public reads (e.g. the demo runs).
 */
export async function getRun(
  runId: string,
  orgId?: string | null
): Promise<{ run: RunRow; events: TraceEvent[] } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = scopedClient(orgId) as any;

  let runQ = supabase
    .from("ad_runs")
    .select(
      "run_id,name,status,input,output,error,metadata,step_count,total_tokens,started_at,ended_at,actor_type,actor_id"
    )
    .eq("run_id", runId);
  if (orgId) runQ = runQ.eq("org_id", orgId);
  const { data: run } = await runQ.single();
  if (!run) return null;

  // Scoped exactly like the run query above. run_id is unique per ORG now, so
  // an unscoped read could splice another tenant's events into this timeline
  // whenever two orgs happen to share a run id.
  let evQ = supabase
    .from("ad_events")
    .select("data")
    .eq("run_id", runId);
  if (orgId) evQ = evQ.eq("org_id", orgId);
  // One run's events. Bounded explicitly: a runaway agent could otherwise
  // exceed PostgREST's cap and render a SILENTLY incomplete timeline — which,
  // for a replay product, is a missing part of the audit trail presented as
  // the whole thing.
  const { data: rows, error } = await evQ.order("seq", { ascending: true }).limit(MAX_EVENTS_PER_RUN);
  if (error) throw new Error(error.message);

  const events = (rows ?? []).map(
    (r: { data: TraceEvent }) => r.data
  ) as TraceEvent[];
  return { run: run as RunRow, events };
}
