/**
 * Coverage-gap analysis — data layer. See lib/eval/policyCoverage.ts for the
 * pure computation this wraps.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { listPolicies } from "@/lib/eval/policies";
import { computeCoverageGaps, type CoverageGap, type ToolUsage } from "@/lib/eval/policyCoverage";

const WINDOW_DAYS = 90;
// Row ceiling for the aggregate read. Events-per-window is unbounded even
// when the org isn't, so this is bounded explicitly rather than trusting
// PostgREST to truncate silently — see lib/runs.ts's MAX_EVENTS_PER_RUN for
// the same reasoning applied per-run instead of per-window.
const MAX_ROWS = 20_000;

export async function getCoverageGaps(orgId: string): Promise<CoverageGap[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const policies = await listPolicies(orgId).catch(() => []);
  const rules = policies.flatMap((p) => p.rules);

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const { data } = await sb
    .from("ad_events")
    .select("tool_name")
    .eq("org_id", orgId)
    .eq("type", "tool")
    .gte("ts_start", since)
    .not("tool_name", "is", null)
    .limit(MAX_ROWS);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { tool_name: string | null }[]) {
    if (!row.tool_name) continue;
    counts.set(row.tool_name, (counts.get(row.tool_name) ?? 0) + 1);
  }
  const usage: ToolUsage[] = [...counts.entries()].map(([tool_name, count]) => ({ tool_name, count }));

  return computeCoverageGaps(rules, usage);
}
