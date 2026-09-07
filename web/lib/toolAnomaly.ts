/**
 * Tool-call anomaly flagging — data layer. See lib/toolAnomalyCore.ts for the
 * pure scoring this wraps. Runs after ingest, over recent history — not part
 * of the live enforcement path.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { listPolicies } from "@/lib/eval/policies";
import { toolsCoveredByRules } from "@/lib/eval/policyCoverage";
import { computeAnomalies, type AnomalyFlag, type ToolCallSample } from "@/lib/toolAnomalyCore";

const WINDOW_DAYS = 30;
// Row ceiling for the aggregate read — same reasoning as policyCoverage.ts's
// MAX_ROWS: events-per-window is unbounded even when the org isn't.
const MAX_ROWS = 20_000;
const MAX_FLAGS = 50;

export interface AnomalyFlagView extends AnomalyFlag {
  agent_name: string | null;
}

export async function getAnomalyFlags(orgId: string): Promise<AnomalyFlagView[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const policies = await listPolicies(orgId).catch(() => []);
  const covered = toolsCoveredByRules(policies.flatMap((p) => p.rules));

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const { data } = await sb
    .from("ad_events")
    .select("run_id,tool_name,ts_start,data")
    .eq("org_id", orgId)
    .eq("type", "tool")
    .gte("ts_start", since)
    .not("tool_name", "is", null)
    .order("ts_start", { ascending: true })
    .limit(MAX_ROWS);

  const samplesByTool = new Map<string, ToolCallSample[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    if (!row.tool_name) continue;
    const arr = samplesByTool.get(row.tool_name) ?? [];
    arr.push({ run_id: row.run_id, tool_name: row.tool_name, ts_start: row.ts_start, input: row.data?.input });
    samplesByTool.set(row.tool_name, arr);
  }

  const flags = computeAnomalies(samplesByTool, covered).slice(0, MAX_FLAGS);
  if (!flags.length) return [];

  const runIds = [...new Set(flags.map((f) => f.run_id))];
  // Already implicitly bounded by MAX_FLAGS via runIds.length — .limit() here
  // is belt-and-suspenders, not load-bearing, but every read on this table
  // gets one on principle (see __tests__/boundedReads.test.ts).
  const { data: runs } = await sb.from("ad_runs").select("run_id,name").eq("org_id", orgId).in("run_id", runIds).limit(MAX_FLAGS);
  const nameByRun = new Map(((runs ?? []) as { run_id: string; name: string | null }[]).map((r) => [r.run_id, r.name]));

  return flags.map((f) => ({ ...f, agent_name: nameByRun.get(f.run_id) ?? null }));
}
