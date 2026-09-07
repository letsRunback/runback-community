/**
 * Daily behavioral drift detection cron.
 * For every org with recent run history, computes drift vs 30-day baseline
 * and writes alerts to ad_drift_alerts when deviation exceeds threshold.
 *
 * Schedule: 0 5 * * * (5 AM UTC, after fleet benchmark at 4 AM)
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { computeOrgDrift, persistDrift } from "@/lib/drift";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  // Find orgs with runs in the last 30 days. Bounded explicitly — same
  // reasoning as every other high-volume read in this codebase (see
  // lib/runs.ts's MAX_EVENTS_PER_RUN): org × agent × day rows over 30 days is
  // unbounded even though this table is a daily aggregate, not raw events.
  const MAX_ROLLUP_ROWS = 200_000;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const { data: activeOrgs } = await sb
    .from("ad_run_rollups")
    .select("org_id")
    .gte("day", since)
    .limit(MAX_ROLLUP_ROWS);

  if (!activeOrgs?.length) return NextResponse.json({ ok: true, orgs: 0 });

  const orgIds = [...new Set<string>(activeOrgs.map((r: { org_id: string }) => r.org_id))];
  const summary: Record<string, { drifting_agents: number; alerts_written: number } | { error: string }> = {};
  let errors = 0;

  // A thrown exception (network-level failure, not just a resolved
  // Supabase {error}) on any one org's computeOrgDrift/persistDrift call used
  // to abort the loop entirely — every org after the failing one in
  // iteration order got no drift computation for the day, with no record of
  // which orgs were skipped. Sibling crons that loop over orgs
  // (billing-reconcile, governance-findings) already guard each iteration;
  // this one didn't.
  for (const orgId of orgIds) {
    try {
      const drifts = await computeOrgDrift(orgId);
      if (!drifts.length) { summary[orgId] = { drifting_agents: 0, alerts_written: 0 }; continue; }
      const idMap = await persistDrift(orgId, drifts);
      summary[orgId] = { drifting_agents: drifts.length, alerts_written: idMap.size };
    } catch (e) {
      errors++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron/drift] org ${orgId} failed, continuing with remaining orgs:`, message);
      summary[orgId] = { error: message };
    }
  }

  return NextResponse.json({ ok: true, orgs: orgIds.length, errors, summary });
}
