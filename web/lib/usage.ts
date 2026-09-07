/**
 * Usage metering + enforcement. Per-org monthly run counters drive hard caps on
 * the free plan (the funnel boundary) and retention sweeps prune old data per
 * plan. Counters are bumped atomically via the bump_usage RPC.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { tombstoneRuns } from "@/lib/ledger";
import { activeHolds, isHeld } from "@/lib/legalHold";
import { usageLimits, effectivePlan, type PlanLimits } from "@/lib/entitlements";
import { reportUsage } from "@/lib/marketplaceMetering";
import { seatStatus } from "@/lib/seats";
import { showcaseOrgId } from "@/lib/demoMode";
import type { TraceEvent } from "@runback/schema";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so reads are capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export function currentPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface Usage {
  period: string;
  runs: number;
  limit: number; // Infinity = unmetered
  pctUsed: number; // 0..1 (0 when unmetered)
  retentionDays: number;
  seats: number;      // limit
  seatsUsed: number;  // actual member count — was display-only before seat enforcement existed
  resetsOn: string; // ISO date of next period start
}

export async function getUsage(orgId: string): Promise<Usage> {
  const period = currentPeriod();
  const sb = db();
  const [{ data }, { data: org }, seats] = await Promise.all([
    sb.from("usage_counters").select("runs").eq("org_id", orgId).eq("period", period).maybeSingle(),
    sb.from("orgs").select("plan, trial_ends_at, vertical").eq("id", orgId).maybeSingle(),
    seatStatus(orgId),
  ]);
  const runs = data?.runs ?? 0;
  const lim: PlanLimits = usageLimits(org || {});
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    period,
    runs,
    limit: lim.runsPerMonth,
    pctUsed: lim.runsPerMonth === Infinity ? 0 : Math.min(1, runs / lim.runsPerMonth),
    retentionDays: lim.retentionDays,
    seats: lim.seats,
    seatsUsed: seats.used,
    resetsOn: reset.toISOString().slice(0, 10),
  };
}

export interface MeterResult {
  allowed: boolean;
  newRuns: number;
  runs: number;
  limit: number;
}

/**
 * Meter a batch before storing it. Counts run-starts for runs that don't yet
 * exist (so retries / event-only batches don't double-count), and blocks NEW
 * runs once a metered plan is at its cap — while letting in-flight runs finish.
 */
export async function meterIngest(orgId: string | null, events: TraceEvent[]): Promise<MeterResult> {
  if (!orgId) return { allowed: true, newRuns: 0, runs: 0, limit: Infinity };
  const sb = db();
  const { data: org } = await sb.from("orgs").select("plan, trial_ends_at").eq("id", orgId).maybeSingle();
  const lim = usageLimits(org || {}).runsPerMonth;
  if (lim === Infinity) return { allowed: true, newRuns: 0, runs: 0, limit: lim };

  const starts = events.filter((e) => e.type === "run" && e.phase === "start").map((e) => e.run_id);
  const period = currentPeriod();

  // current usage
  const { data: cur } = await sb.from("usage_counters").select("runs").eq("org_id", orgId).eq("period", period).maybeSingle();
  const used = cur?.runs ?? 0;

  if (starts.length === 0) return { allowed: true, newRuns: 0, runs: used, limit: lim };

  // which of these run-starts are genuinely new (not already stored)?
  // Scoped: `starts` are run ids supplied by the caller's own payload. Without
  // the org filter, another tenant already holding one of those ids makes it
  // look "already stored", so the run is not counted against quota.
  const { data: existing } = await sb.from("ad_runs").select("run_id").eq("org_id", orgId).in("run_id", starts).limit(MAX_ROWS);
  const known = new Set((existing || []).map((r: { run_id: string }) => r.run_id));
  const newRuns = starts.filter((id) => !known.has(id)).length;
  if (newRuns === 0) return { allowed: true, newRuns: 0, runs: used, limit: lim };

  // Cap check + increment as ONE atomic call (bump_usage_capped row-locks
  // the counter for the duration), not a separate read-then-write. This used
  // to read `used` above, compare `used + newRuns > lim` in application code,
  // and only then call bump_usage — two concurrent requests near the ceiling
  // could both pass that read-time check and both commit, overshooting the
  // cap by up to (concurrent request count - 1) x batch size. See
  // sql/add_bump_usage_capped.sql.
  const { data: capped, error: rpcError } = await sb
    .rpc("bump_usage_capped", { p_org: orgId, p_period: period, p_n: newRuns, p_limit: lim })
    .single();
  if (rpcError || !capped) {
    console.error("[usage] bump_usage_capped failed:", rpcError?.message);
    // Fail closed on the metering call itself breaking — an over-cap ingest
    // that silently succeeds is worse than a rejected batch during an outage.
    return { allowed: false, newRuns, runs: used, limit: lim };
  }
  const result = capped as { allowed: boolean; runs: number };
  if (result.allowed) {
    // Marketplace metering (if configured) piggybacks on the same acceptance
    // point — fire-and-forget, never awaited inline, so a metering hiccup can't
    // slow down or fail an ingest request.
    void reportUsage(orgId, "runs", newRuns);
  }
  return { allowed: result.allowed, newRuns, runs: result.runs, limit: lim };
}

/**
 * Delete runs older than each org's plan retention. Cascades to events.
 * Returns the number of runs pruned. Safe to run repeatedly (idempotent).
 */
/**
 * Tiered retention. Past the plan's retention window we drop each run's bulky
 * event payloads (the context windows — the storage cost at scale) but KEEP the
 * run summary, its cassette digest, and its ledger entry. The record stays
 * listable and provable forever; only the replayable payload ages out.
 */
export async function enforceRetention(): Promise<{ pruned: number; byPlan: Record<string, number> }> {
  const sb = db();
  const { data: orgs } = await sb.from("orgs").select("id, plan, trial_ends_at, vertical");
  const byPlan: Record<string, number> = {};
  let pruned = 0;
  // The public showcase org's runs are synthetic fixtures re-seeded on demand,
  // not real customer data — plan-based retention (a privacy/storage-cost
  // control for actual tenants) doesn't apply to it. Without this exemption,
  // the sweep silently deleted its event payloads ~2-4 weeks after each
  // seeding, leaving the public demo's Inspect tab, Time-travel replay, and
  // audit/proof downloads all quietly broken for every visitor, while the
  // run list itself kept looking fine (its step/token counts are denormalized
  // onto ad_runs at ingest and don't depend on the events surviving).
  const showcase = await showcaseOrgId().catch(() => null);
  for (const org of orgs || []) {
    if (org.id === showcase) continue;
    try {
      const days = usageLimits(org).retentionDays;
      if (days === Infinity) continue;
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      // up to 20k runs/org/sweep; a large backlog catches up over nightly runs.
      const { data: old } = await sb
        .from("ad_runs")
        .select("run_id,name,started_at,created_at")
        .eq("org_id", org.id)
        .eq("payloads_pruned", false)
        .lt("created_at", cutoff)
        .limit(20000);

      // Legal hold outranks retention. A preservation obligation is the one
      // reason a customer cannot let us prune on schedule, and deleting through
      // one is spoliation — so if the holds cannot be read, prune NOTHING for
      // this org rather than risk destroying preserved records.
      let holds;
      try {
        holds = await activeHolds(org.id);
      } catch (e) {
        console.error(`[retention] skipping org ${org.id} — could not read legal holds:`, e);
        continue;
      }
      const candidates = (old || []) as { run_id: string; name?: string | null; started_at?: string | null; created_at?: string | null }[];
      const keep = candidates.filter((r) => isHeld(r, holds));
      if (keep.length) {
        console.log(`[retention] ${keep.length} run(s) preserved by ${holds.length} legal hold(s) for org ${org.id}`);
      }
      const ids = candidates.filter((r) => !isHeld(r, holds)).map((r) => r.run_id);
      if (ids.length) {
        // org-scoped, even though `ids` came from an org-scoped select. run ids
        // are unique per tenant now, so a bare .in("run_id", ids) DELETE would
        // also destroy another org's events wherever an id is shared — one
        // org's retention sweep silently deleting a second org's payloads.
        await sb.from("ad_events").delete().eq("org_id", org.id).in("run_id", ids);                          // drop payloads
        await sb.from("ad_runs").update({ payloads_pruned: true }).eq("org_id", org.id).in("run_id", ids);   // keep summary + digest + ledger
        pruned += ids.length;
        const ep = effectivePlan(org.plan); byPlan[ep] = (byPlan[ep] || 0) + ids.length;
      }

      // Second sweep: delete run SUMMARIES that are past 2× the retention window.
      // GDPR data minimisation (Art.5) — keeping infinite summary rows contradicts it.
      const summaryCutoff = new Date(Date.now() - 2 * days * 86400_000).toISOString();
      const { data: stale } = await sb
        .from("ad_runs")
        .select("run_id,name,started_at,created_at")
        .eq("org_id", org.id)
        .eq("payloads_pruned", true)
        .lt("created_at", summaryCutoff)
        .limit(20000);
      // The hold applies here too. This sweep deletes the run row outright, so
      // missing it would destroy exactly what the first sweep preserved.
      const staleIds = ((stale || []) as { run_id: string; name?: string | null; started_at?: string | null; created_at?: string | null }[])
        .filter((r) => !isHeld(r, holds))
        .map((r) => r.run_id);
      if (staleIds.length) {
        // Record WHY each run is about to disappear before it does, so
        // verifyLedger() can tell "deleted by retention policy" apart from
        // "deleted by an attacker" for any sealed ledger entry pointing at it.
        //
        // The previous form chained `.catch()` onto the upsert, which never
        // fires: a PostgREST query resolves with { error } instead of
        // rejecting, so a failed tombstone write was invisible and the delete
        // below went ahead regardless — orphaning the ledger entry it was
        // supposed to explain. tombstoneRuns() checks the error and returns
        // false, and we skip the delete rather than create an unexplained gap.
        const explained = await tombstoneRuns(org.id, staleIds, "retention");
        if (!explained) {
          console.error(
            `[retention] skipping delete of ${staleIds.length} run(s) for org ${org.id} — ` +
            `could not write tombstones, and deleting without them would report as ledger tampering.`
          );
        } else {
          // ad_events already pruned; cascade also covers any remaining rows.
          await sb.from("ad_runs").delete().eq("org_id", org.id).in("run_id", staleIds);
        }
      }
    } catch (e) {
      console.warn("[retention] org sweep skipped:", e);
    }
  }
  return { pruned, byPlan };
}
