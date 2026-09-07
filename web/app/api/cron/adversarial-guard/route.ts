/**
 * Feature #5 MVP — the trigger half of the live kill-switch.
 *
 * The plan for this cron was to spend fresh live-model counterfactual
 * replay (wholeRun.ts's counterfactualRunHybrid) per sampled run as the
 * divergence oracle. Building it, a better primitive was already sitting
 * in the codebase: lib/drift.ts's computeOrgDrift() — a real, tested,
 * statistically-grounded per-agent divergence score, already computed
 * hourly by cron/drift, from stored run data, with NO live model spend.
 * Reusing it instead is the more responsible choice for something an
 * autonomous cron runs unattended across every guard-entitled org: same
 * "reuse an existing primitive, don't reinvent" principle, without paying
 * real API cost on every tick just to decide whether to pull a switch.
 *
 * "critical" severity (computeOrgDrift's own existing alert threshold,
 * shared with the drift dashboard) revokes the agent. Anything below that
 * un-revokes it if it was previously revoked — always writing, per run,
 * clears a stale revocation the moment an agent's behavior recovers,
 * rather than leaving it stuck revoked until someone notices.
 *
 * Schedule: every 2 minutes (cron "star-slash-2 star star star star") — the real latency floor for
 * "revoked within the polling window" this MVP promises; see
 * lib/guard.ts and the SDK's enforceToolCall cache TTL).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { orgHasFeature } from "@/lib/planGate";
import { computeOrgDrift } from "@/lib/drift";
import { setAuthorizationState } from "@/lib/guard";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  // Same bounded-recent-activity pattern as the other hourly crons — orgs
  // with runs in the last 24h. Entitlement (guard) is checked per-org below,
  // same as scope-audit: this list is "who might need checking", not "who's
  // entitled".
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
  let revoked = 0;
  let errors = 0;

  for (const orgId of orgIds) {
    try {
      if (!(await orgHasFeature(orgId, "guard"))) {
        summary[orgId] = { skipped: "not entitled" };
        continue;
      }
      const drifts = await computeOrgDrift(orgId);
      const actions: { agent: string; revoked: boolean }[] = [];
      for (const d of drifts) {
        const shouldRevoke = d.severity === "critical";
        await setAuthorizationState(
          orgId,
          d.agent,
          shouldRevoke,
          shouldRevoke ? `Drift severity critical (score ${d.drift_score.toFixed(2)}) — see /app/models/drift` : null
        );
        if (shouldRevoke) revoked++;
        actions.push({ agent: d.agent, revoked: shouldRevoke });
      }
      summary[orgId] = { agents_checked: drifts.length, actions };
    } catch (e) {
      errors++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron/adversarial-guard] org ${orgId} failed, continuing with remaining orgs:`, message);
      summary[orgId] = { error: message };
    }
  }

  return NextResponse.json({ ok: true, orgs: orgIds.length, revoked, errors, summary });
}
