/**
 * Golden suite — auto-mine production incidents into permanent regression tests.
 *
 * A finished run that went "bad" (a runtime policy block, or an error) is enrolled
 * as a golden test, deduped by a SIGNATURE of the failing decision so a thousand
 * identical failures collapse to one test. Re-running the suite re-executes each
 * captured incident deterministically and verifies it still reproduces its sealed
 * cassette — the corpus is mined from reality and grows with usage.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getRun } from "@/lib/runs";
import { sha256, canonical } from "@runback/replay";
import { counterfactualIfAvailable } from "@/lib/counterfactualHook";
import { verifyReproduces } from "@/lib/reexecuteHook";
import { detectBad, computeStreak, suggestRule, needsReReview, type RuleSuggestion } from "@/lib/goldenCore";
import { listPolicies } from "@/lib/eval/policies";
import type { TraceEvent } from "@runback/schema";

/** A stable hash so the demo's recur/changed verdict varies by (incident, model) but is deterministic. */
function ghash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export { detectBad, suggestRule, type BadSignature, type RuleSuggestion } from "@/lib/goldenCore";

export interface GoldenEntry {
  id: string;
  run_id: string;
  reason: string;
  signature: string;
  detail: string | null;
  baseline_digest: string | null;
  status: string;
  created_at: string;
  last_run_at: string | null;
  last_result: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  dataset_id?: string | null;
  tool_name?: string | null;
  /** Computed from ad_golden_runs, not stored on the row — see attachStreaks(). */
  streak_runs?: number;
  streak_policy_revisions?: number;
  /** Computed from reason/tool_name at read time, never stored — see suggestRule(). */
  suggestion?: RuleSuggestion | null;
  /** Computed at read time, never stored — see needsReReview() in goldenCore.ts.
   *  Reproducing a cassette proves the incident still replays the same way; it
   *  doesn't mean the recorded behavior is still the right one. */
  needs_re_review?: boolean;
}

/**
 * A fingerprint of which policy version is live for every named policy in the
 * org right now — not the rule content itself, just name@version pairs. Used
 * to tag each golden-suite run with "what was enforced at the time," so a
 * streak of good results is visibly a claim that survived N policy revisions,
 * not just N clock ticks. Cheap and stable: same org, same live policy set →
 * same digest, regardless of who's asking or when within that window.
 */
export async function policySnapshotDigest(orgId: string): Promise<string | null> {
  try {
    const policies = await listPolicies(orgId);
    if (!policies.length) return null;
    const fingerprint = policies.map((p) => `${p.name}@${p.version}`).sort();
    return sha256(canonical(fingerprint));
  } catch {
    return null;
  }
}

export interface GoldenReport {
  total_active: number;
  enrolled_this_week: number;
  replay_divergence_rate: number;
  weekly_enrollments: Array<{ week: string; count: number }>;
  entries: GoldenEntry[];
}

/** djb2 hash — stable, no crypto import needed (used for manual-enrollment signatures). */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/** ISO date of the Sunday that starts the week containing d (UTC). */
function weekStart(d: Date): string {
  const day = new Date(d);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  day.setUTCHours(0, 0, 0, 0);
  return day.toISOString().slice(0, 10);
}

/** Fetch all golden entries for the org and compute flywheel report. */
export async function getGoldenReport(orgId: string): Promise<GoldenReport> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const sb = getAdminClient() as any;
    const { data } = await sb
      .from("ad_golden")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const entries: GoldenEntry[] = (data ?? []) as GoldenEntry[];

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400_000);
    const total_active = entries.filter((e) => e.status === "active").length;
    const enrolled_this_week = entries.filter((e) => new Date(e.created_at) >= weekAgo).length;

    const withResult = entries.filter((e) => !!e.last_result);
    const diverged = withResult.filter((e) => e.last_result === "diverged").length;
    const replay_divergence_rate = withResult.length > 0 ? diverged / withResult.length : 0;

    // Build 12-week buckets (Sunday-start, oldest first).
    const weeks: Array<{ week: string; count: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const ws = weekStart(new Date(now.getTime() - i * 7 * 86400_000));
      weeks.push({ week: ws, count: 0 });
    }
    for (const e of entries) {
      const ws = weekStart(new Date(e.created_at));
      const bucket = weeks.find((w) => w.week === ws);
      if (bucket) bucket.count++;
    }

    // Only ever computed for STILL-ACTIVE error incidents — an approved or
    // dismissed entry has already had its human decision made, and a
    // policy_block entry is already covered (suggestRule() returns null for
    // it anyway, but skipping the call entirely keeps this honest at a glance).
    for (const e of entries) {
      if (e.status === "active" && e.reason === "error") {
        e.suggestion = suggestRule({ reason: "error", signature: e.signature, detail: e.detail ?? "", tool_name: e.tool_name ?? undefined });
      }
      e.needs_re_review = needsReReview({ status: e.status, approved_at: e.approved_at ?? null, created_at: e.created_at });
    }

    await attachStreaks(orgId, entries);

    return { total_active, enrolled_this_week, replay_divergence_rate, weekly_enrollments: weeks, entries };
  } catch {
    return { total_active: 0, enrolled_this_week: 0, replay_divergence_rate: 0, weekly_enrollments: [], entries: [] };
  }
}

/**
 * Mutates each entry with streak_runs and streak_policy_revisions — see
 * computeStreak() in goldenCore.ts for what these mean and why they can't be
 * reconstructed from an exported snapshot of ad_golden.
 */
async function attachStreaks(orgId: string, entries: GoldenEntry[]): Promise<void> {
  if (!entries.length) return;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sb = getAdminClient() as any;
  const ids = entries.map((e) => e.id);
  const { data } = await sb
    .from("ad_golden_runs")
    .select("entry_id,ran_at,result,policy_digest")
    .in("entry_id", ids)
    .order("ran_at", { ascending: false })
    .limit(5000)
    .then((r: { data: unknown }) => r, () => ({ data: null }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const rows = (data ?? []) as { entry_id: string; ran_at: string; result: string; policy_digest: string | null }[];
  if (!rows.length) return;

  const byEntry = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byEntry.get(r.entry_id) ?? [];
    arr.push(r);
    byEntry.set(r.entry_id, arr);
  }

  for (const e of entries) {
    const history = byEntry.get(e.id);
    if (!history) continue; // already sorted newest-first by the query above
    const { runs, policyRevisions } = computeStreak(history);
    e.streak_runs = runs;
    e.streak_policy_revisions = policyRevisions;
  }
}

/** Manually enroll a run as a golden test (deduped). Creates/links the "Production incidents" dataset. */
export async function enrollRun(
  orgId: string,
  runId: string,
  reason: "policy_block" | "error",
  detail: string
): Promise<void> {
  const signature = djb2(`${reason}:${detail}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sb = getAdminClient() as any;

  // Find or create the "Production incidents" dataset.
  let datasetId: string | null = null;
  try {
    const { data: ds } = await sb
      .from("ad_datasets")
      .select("id")
      .eq("org_id", orgId)
      .eq("name", "Production incidents")
      .maybeSingle();
    if (ds?.id) {
      datasetId = ds.id as string;
    } else {
      const { data: newDs } = await sb
        .from("ad_datasets")
        .insert({
          org_id: orgId,
          name: "Production incidents",
          description: "Auto-enrolled production incidents",
          item_count: 0,
        })
        .select("id")
        .single();
      datasetId = newDs?.id ?? null;
    }
  } catch { /* dataset table may lag */ }

  await sb.from("ad_golden").upsert(
    { org_id: orgId, run_id: runId, reason, signature, detail, status: "active", dataset_id: datasetId },
    { onConflict: "org_id,signature", ignoreDuplicates: true }
  );

  // Backfill dataset_id if the entry already existed without one.
  if (datasetId) {
    await sb
      .from("ad_golden")
      .update({ dataset_id: datasetId })
      .eq("org_id", orgId)
      .eq("run_id", runId)
      .is("dataset_id", null);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Approve a golden entry — marks it as a confirmed corpus member.
 * Keyed on the entry's own id, not run_id: a run can have more than one
 * golden entry (enrollIfBad dedupes on org_id+signature, not run_id), so
 * a run_id-keyed update would flip every entry on that run, not just the
 * one the user clicked. */
export async function approveRun(orgId: string, entryId: string, userEmail: string): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const sb = getAdminClient() as any;
  await sb
    .from("ad_golden")
    .update({ status: "approved", approved_by: userEmail, approved_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", entryId);
}

/** Dismiss a golden entry — removes it from the active corpus. Keyed on the
 * entry's own id — see approveRun for why run_id would be wrong here. */
export async function dismissRun(orgId: string, entryId: string): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const sb = getAdminClient() as any;
  await sb
    .from("ad_golden")
    .update({ status: "dismissed" })
    .eq("org_id", orgId)
    .eq("id", entryId);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Auto-enroll a bad run as a golden test (deduped). Best-effort — never throws into ingest. */
export async function enrollIfBad(orgId: string, runId: string, runName: string, events: TraceEvent[], digest: string): Promise<void> {
  const bad = detectBad(runName, events);
  if (!bad) return;
  try {
    const sb = getAdminClient() as any;
    await sb.from("ad_golden").upsert(
      {
        org_id: orgId,
        run_id: runId,
        reason: bad.reason,
        signature: bad.signature,
        detail: bad.detail,
        baseline_digest: digest,
        status: "active",
        tool_name: bad.tool_name ?? null,
      },
      { onConflict: "org_id,signature", ignoreDuplicates: true }
    );
  } catch {
    /* table may not exist yet (migration lag) — never break ingest */
  }
}

export async function listGolden(orgId: string): Promise<GoldenEntry[]> {
  try {
    const sb = getAdminClient() as any;
    const { data } = await sb
      .from("ad_golden")
      .select("*")
      .eq("org_id", orgId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(200);
    return (data ?? []) as GoldenEntry[];
  } catch {
    return [];
  }
}

/** Per-entry result: integrity mode → reproduced|diverged; candidate mode → recurs|changed. */
export type GoldenResult = "reproduced" | "diverged" | "recurs" | "changed" | "missing" | "unknown";

export interface GoldenRunResult {
  total: number;
  mode: "integrity" | "candidate";
  model: string | null;
  /** Good outcomes: reproduced (integrity) or changed (incident no longer recurs). */
  ok: number;
  /** Bad outcomes: diverged (integrity broke) or recurs (the incident comes back). */
  flagged: number;
  missing: number;
  byReason: { policy_block: number; error: number };
  entries: { id: string; run_id: string; reason: string; detail: string | null; result: GoldenResult }[];
}

/**
 * Re-run the whole suite. Two modes:
 *   • integrity (no model) — re-execute each incident and verify it reproduces its
 *     sealed cassette. Deterministic, no model calls.
 *   • candidate (a model) — re-run each incident on that model and report whether
 *     it RECURS (the same bad decisions) or has CHANGED (diverges → likely fixed).
 *     This is the "would this candidate bring the incident back?" check.
 */
export async function runGoldenSuite(orgId: string, opts?: { model?: string; demo?: boolean }): Promise<GoldenRunResult> {
  const sb = getAdminClient() as any;
  const model = opts?.model || null;
  const demo = opts?.demo ?? false;
  // Candidate-model runs drive the H3 engine live — Enterprise; fail-closed second
  // layer beneath the route gate (assertFeature is a no-op for demo accounts).
  if (model) {
    const { assertFeature } = await import("@/lib/planGate");
    await assertFeature(orgId, "deep_replay", demo);
  }
  const entries = await listGolden(orgId);
  let ok = 0, flagged = 0, missing = 0;
  const byReason = { policy_block: 0, error: 0 };
  // Computed once per suite run, not per entry — it's a snapshot of the org's
  // whole live policy set, the same for every entry evaluated in this pass.
  const policyDigest = await policySnapshotDigest(orgId);

  // Per-entry replay/counterfactual lookups are independent — run them
  // concurrently (capped, since a real org's corpus can hold up to 200
  // entries and each one is a network round-trip) instead of one at a
  // time. Previously this loop serialized every entry's DB read AND its
  // status-update write, so a 20-entry suite took 20+ sequential round
  // trips; a click on "Run suite" could visibly hang for seconds.
  const CONCURRENCY = 10;
  const out: GoldenRunResult["entries"] = new Array(entries.length);
  for (let start = 0; start < entries.length; start += CONCURRENCY) {
    const batch = entries.slice(start, start + CONCURRENCY);
    const results = await Promise.all(batch.map(async (e) => {
      let result: GoldenResult;
      if (model) {
        // Candidate-model run: does the incident recur on this model?
        if (demo) {
          // Deterministic, clearly-labelled: a subset of (incident, model) pairs recur.
          result = ghash(`${e.run_id}:${model}`) % 3 === 0 ? "recurs" : "changed";
        } else {
          const cf = await counterfactualIfAvailable(e.run_id, model, false, orgId);
          result = !cf ? "missing" : cf.frontier === null ? "recurs" : "changed";
        }
      } else {
        const data = await getRun(e.run_id, orgId);
        if (!data) {
          result = "missing";
        } else {
          // "unknown" when this build has no re-execution engine — reporting
          // "reproduced" without having re-executed would be a false claim
          // about an audit artefact, and "diverged" would invent a regression.
          const v = verifyReproduces(data.events as TraceEvent[], e.baseline_digest);
          result = !v.known ? "unknown" : v.ok ? "reproduced" : "diverged";
        }
      }
      return { e, result };
    }));
    for (let i = 0; i < results.length; i++) {
      const { e, result } = results[i];
      if (e.reason === "policy_block" || e.reason === "error") byReason[e.reason]++;
      if (result === "recurs" || result === "diverged") flagged++;
      // "unknown" counts with "missing", never with ok: both mean the suite
      // could not answer for this entry. Falling through to ok++ would have
      // reported an unverified entry as a pass.
      else if (result === "missing" || result === "unknown") missing++;
      else ok++;
      out[start + i] = { id: e.id, run_id: e.run_id, reason: e.reason, detail: e.detail, result };
    }
  }

  // Single batched write instead of one UPDATE per entry — `id` is the
  // primary key, so upsert here behaves as a bulk update.
  if (out.length) {
    const now = new Date().toISOString();
    try {
      await sb.from("ad_golden").upsert(
        out.map((o) => ({ id: o.id, last_run_at: now, last_result: o.result })),
      );
    } catch { /* best-effort */ }
    // Append-only history, separate from the overwrite above — see
    // add_golden_history.sql. This is what a streak is actually computed
    // from; the ad_golden row only ever knows its latest result.
    try {
      await sb.from("ad_golden_runs").insert(
        out.map((o) => ({
          entry_id: o.id, org_id: orgId, ran_at: now,
          mode: model ? "candidate" : "integrity", model,
          result: o.result, policy_digest: policyDigest,
        })),
      );
    } catch { /* best-effort — a missing history row degrades the streak count, not correctness */ }
  }

  return { total: entries.length, mode: model ? "candidate" : "integrity", model, ok, flagged, missing, byReason, entries: out };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
