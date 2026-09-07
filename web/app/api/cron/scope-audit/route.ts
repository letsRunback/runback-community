/**
 * Scope-violation detection cron.
 * For every org with recent delegation activity, checks non-wildcard
 * delegation edges' actual tool-call history against their declared,
 * signed scope, and persists any violations found — see
 * lib/trust.ts's auditScopeViolations() and scopeAllows().
 *
 * A violation can only be known after the child run has executed, so this
 * is necessarily a periodic detection pass over completed history, not
 * something checked live at attestation time.
 *
 * Schedule: 40 * * * * (hourly, offset from seal-checkpoints at :20 and
 * siem at :00 so the three hourly crons don't all fire at once).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { auditScopeViolations } from "@/lib/trust";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  // Same bounded-recent-activity pattern as cron/drift and
  // cron/seal-checkpoints: only orgs with runs in the last 24h have new
  // delegation edges worth (re-)checking.
  const MAX_ROLLUP_ROWS = 200_000;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  const { data: activeOrgs } = await sb
    .from("ad_run_rollups")
    .select("org_id")
    .gte("day", since)
    .limit(MAX_ROLLUP_ROWS);

  if (!activeOrgs?.length) return NextResponse.json({ ok: true, orgs: 0 });

  const orgIds = [...new Set<string>(activeOrgs.map((r: { org_id: string }) => r.org_id))];
  const summary: Record<string, unknown> = {};
  let errors = 0;

  for (const orgId of orgIds) {
    try {
      const result = await auditScopeViolations(orgId);
      summary[orgId] = result;
    } catch (e) {
      errors++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron/scope-audit] org ${orgId} failed, continuing with remaining orgs:`, message);
      summary[orgId] = { error: message };
    }
  }

  return NextResponse.json({ ok: true, orgs: orgIds.length, errors, summary });
}
