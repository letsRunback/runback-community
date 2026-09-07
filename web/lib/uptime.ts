/**
 * Availability recording and the numbers behind the public status page.
 *
 * A deployment cannot fully observe its own outage — if the app is down, the
 * cron recording the check does not run. That is not a reason to skip this: it
 * is a reason to be explicit about what the record does and does not prove.
 * A missing check is treated as unknown rather than healthy, and a stale last
 * check reads as degraded, so silence never renders as green.
 */
import { getAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/** A check older than this means the recorder itself stopped — treat as degraded. */
export const STALE_AFTER_MINUTES = 20;

export interface UptimeDay {
  day: string;
  checks: number;
  failures: number;
  uptime_pct: number | null;
  p50_ms: number | null;
}

export interface UptimeStatus {
  /** ok = last check passed and is recent; degraded = stale or partial; down = last check failed. */
  state: "ok" | "degraded" | "down";
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  detail: string | null;
  days: UptimeDay[];
  /** Uptime across the window, computed from checks actually recorded. */
  windowUptimePct: number | null;
}

export async function recordCheck(ok: boolean, latencyMs: number, detail?: string | null): Promise<void> {
  const { error } = await db()
    .from("ad_uptime_checks")
    .insert({ ok, latency_ms: latencyMs, detail: detail ?? null });
  if (error) console.error("[uptime] could not record a check:", error.message);
}

/** The most recent check, used to decide the current state. */
export async function lastCheck(): Promise<{ ok: boolean; checked_at: string; latency_ms: number | null; detail: string | null } | null> {
  const { data, error } = await db()
    .from("ad_uptime_checks")
    .select("ok,checked_at,latency_ms,detail")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not read the last check: ${error.message}`);
  return data ?? null;
}

export async function uptimeStatus(days = 90): Promise<UptimeStatus> {
  const [{ data: rows, error }, last] = await Promise.all([
    db().rpc("uptime_summary", { p_days: days }),
    lastCheck().catch(() => null),
  ]);
  if (error) throw new Error(`could not compute uptime: ${error.message}`);

  const summary = ((rows ?? []) as UptimeDay[]).map((d) => ({
    ...d,
    checks: Number(d.checks),
    failures: Number(d.failures),
    uptime_pct: d.uptime_pct === null ? null : Number(d.uptime_pct),
  }));

  const totalChecks = summary.reduce((n, d) => n + d.checks, 0);
  const totalFailures = summary.reduce((n, d) => n + d.failures, 0);

  let state: UptimeStatus["state"] = "ok";
  if (!last) {
    state = "degraded";
  } else if (!last.ok) {
    state = "down";
  } else {
    // A recent PASS is the only thing that justifies green. If the recorder
    // stopped, we do not know the service is up — and reporting green from an
    // absence of bad news is how a status page becomes worthless.
    const ageMin = (Date.now() - new Date(last.checked_at).getTime()) / 60_000;
    if (ageMin > STALE_AFTER_MINUTES) state = "degraded";
  }

  return {
    state,
    lastCheckedAt: last?.checked_at ?? null,
    lastLatencyMs: last?.latency_ms ?? null,
    detail: last?.detail ?? null,
    days: summary,
    windowUptimePct: totalChecks > 0 ? Math.round((100 * (totalChecks - totalFailures)) / totalChecks * 100) / 100 : null,
  };
}

/** Drop checks past the window so the table stays small without a separate job. */
export async function pruneChecks(keepDays = 120): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86400_000).toISOString();
  const { data, error } = await db()
    .from("ad_uptime_checks").delete().lt("checked_at", cutoff).select("id");
  if (error) { console.error("[uptime] prune failed:", error.message); return 0; }
  return (data ?? []).length;
}

/**
 * Warn once when a table is approaching the size where its design stops
 * holding — today that is ad_events, which is unpartitioned.
 *
 * Recorded through the error tracker rather than as its own alert channel.
 * That is not laziness: the tracker already groups by fingerprint and notifies
 * once per distinct fault, which is exactly the semantics a capacity warning
 * needs. A daily cron emailing "still large" forever is how a real warning gets
 * filtered into a folder nobody opens.
 *
 * The threshold is deliberately well below where it hurts. A capacity warning
 * that arrives when the problem has already started is a status report.
 */
const CAPACITY_WATCH: { table: string; warnAt: number; why: string }[] = [
  {
    table: "ad_events",
    warnAt: 5_000_000,
    why: "ad_events is a single unpartitioned table. Past roughly 10M rows, index " +
         "maintenance and the retention sweep begin to degrade. Plan partitioning " +
         "by month, or archival, before that.",
  },
];

export async function checkCapacity(): Promise<{ table: string; rows: number; warned: boolean }[]> {
  const { captureError } = await import("@/lib/errorTracking");
  const out: { table: string; rows: number; warned: boolean }[] = [];

  for (const w of CAPACITY_WATCH) {
    const { count, error } = await db()
      .from(w.table)
      .select("*", { count: "exact", head: true });
    if (error) {
      console.error(`[capacity] could not count ${w.table}:`, error.message);
      continue;
    }
    const rows = count ?? 0;
    const warned = rows >= w.warnAt;
    if (warned) {
      // Message is stable so every occurrence groups into one fault. The row
      // count is normalised away by the fingerprinter, which is what stops a
      // growing table from producing a new "fault" every single day.
      await captureError(
        new Error(`Capacity warning: ${w.table} has passed ${w.warnAt.toLocaleString()} rows. ${w.why}`),
        { route: "cron/capacity", severity: "warning" }
      );
    }
    out.push({ table: w.table, rows, warned });
  }
  return out;
}
