/**
 * Periodic ledger checkpoint sealing.
 * For every org entitled to the tamper-evident ledger, seals the current
 * head into a signed, externally witnessed (RFC 3161) and publicly
 * published checkpoint — see lib/ledger.ts's sealCheckpoint(). Previously
 * this only ran on-demand via POST /api/app/ledger, so an org that never
 * opened that page had an unsealed, unwitnessed ledger indefinitely: real
 * runs, no external anchor proving nobody (including Runback) rewrote them.
 *
 * Schedule: 0 * * * * (hourly — frequent enough to keep the unanchored
 * window short without sealing on every single run).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { orgHasFeature } from "@/lib/planGate";
import { sealCheckpoint } from "@/lib/ledger";
import { cronAuthorized } from "@/lib/cronAuth";
import { DEMO_MODE, showcaseOrgId } from "@/lib/demoMode";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  // Same bounded-recent-activity pattern as cron/drift: orgs with runs in the
  // last 24h, not the whole org table — an org with no new runs since its
  // last seal has nothing new to anchor.
  const MAX_ROLLUP_ROWS = 200_000;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  const { data: activeOrgs } = await sb
    .from("ad_run_rollups")
    .select("org_id")
    .gte("day", since)
    .limit(MAX_ROLLUP_ROWS);

  if (!activeOrgs?.length) return NextResponse.json({ ok: true, orgs: 0 });

  const allOrgIds = [...new Set<string>(activeOrgs.map((r: { org_id: string }) => r.org_id))];

  // Process the STALEST first — orgs never sealed, then longest since their last
  // checkpoint. The loop is bounded by a deadline below, and without an ordering
  // it would cut at the same place every hour: a stable org list means the tail
  // is starved forever, silently, while the head is re-sealed needlessly. Sorting
  // by staleness makes truncation rotate, so every org is reached eventually and
  // the worst case is a delay rather than permanent omission. It also needs no
  // cursor table — the data already says who waited longest.
  const { data: ckpts } = await sb
    .from("ad_ledger_checkpoints")
    .select("org_id,created_at")
    .in("org_id", allOrgIds.slice(0, 1000))
    .order("created_at", { ascending: false });
  const lastSealed = new Map<string, string>();
  for (const row of (ckpts ?? []) as { org_id: string; created_at: string }[]) {
    if (!lastSealed.has(row.org_id)) lastSealed.set(row.org_id, row.created_at);
  }
  const orgIds = allOrgIds.sort((a, b) => {
    const ta = lastSealed.get(a) ?? "";   // never sealed sorts first
    const tb = lastSealed.get(b) ?? "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  // Stop with room to spare inside maxDuration (300s) so the handler returns a
  // real summary instead of being killed mid-org. A truncated run that REPORTS
  // what it skipped is recoverable; one that dies silently is the failure this
  // guard exists for.
  const DEADLINE_MS = 240_000;
  const startedAt = Date.now();

  const summary: Record<string, unknown> = {};
  let sealed = 0;
  let errors = 0;
  let unchanged = 0;
  let deferred = 0;

  // Same demo bypass /api/app/ledger's ledgerAllowed() grants: the whole
  // deployment is a demo (DEMO_MODE) or this is the standard demo org, which
  // every interactive ledger endpoint already treats as entitled regardless
  // of its (free) plan. Without this, the cron silently skipped the exact
  // org every self-host evaluator is shown first.
  const demoOrgId = DEMO_MODE ? null : await showcaseOrgId();

  for (const orgId of orgIds) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      deferred = orgIds.length - Object.keys(summary).length;
      break;
    }
    try {
      const isDemoOrg = DEMO_MODE || orgId === demoOrgId;
      // Pre-filter on entitlement rather than letting sealCheckpoint's own
      // assertLedger() throw per non-Enterprise org — same result, but the
      // per-org summary distinguishes "not entitled" from "sealing failed".
      if (!isDemoOrg && !(await orgHasFeature(orgId, "ledger"))) {
        summary[orgId] = { skipped: "not entitled" };
        continue;
      }
      // skipIfUnchanged: an unmoved head needs no new checkpoint, and skipping
      // avoids a full ledger read, an insert and two external TSA requests.
      const result = await sealCheckpoint(orgId, false, { skipIfUnchanged: true });
      if (!result) {
        summary[orgId] = { skipped: "empty ledger" };
        continue;
      }
      if (result.unchanged) {
        unchanged++;
        summary[orgId] = { skipped: "unchanged since last checkpoint", seq: result.seq };
        continue;
      }
      sealed++;
      summary[orgId] = {
        seq: result.seq,
        witnesses: result.witnesses,
        published: !!result.published,
      };
    } catch (e) {
      errors++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron/seal-checkpoints] org ${orgId} failed, continuing with remaining orgs:`, message);
      summary[orgId] = { error: message };
    }
  }

  // `deferred` is reported, not swallowed. A run that quietly did two thirds of
  // its work looks identical to a healthy one in logs, which is how a starved
  // tail goes unnoticed for weeks.
  return NextResponse.json({
    ok: true,
    orgs: orgIds.length,
    sealed,
    unchanged,
    errors,
    deferred,
    took_ms: Date.now() - startedAt,
    summary,
  });
}
