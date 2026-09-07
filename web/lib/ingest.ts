import { getAdminClient } from "@/lib/supabase/admin";
import { INGEST_SCOPES, type ApiKeyScope } from "@/lib/apiKeys";
import { tryWrite } from "@/lib/supabase/write";
import { cassetteChainFromEvents } from "@runback/replay";
import type { TraceEvent, RunEvent } from "@runback/schema";
import { after } from "next/server";
import { evaluateRunAlerts } from "@/lib/alertHook";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so reads are capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

/**
 * Persist a batch of trace events into ad_runs / ad_events. Idempotent on
 * (run_id, span_id), so retries and overlapping batches are safe. Shared by the
 * native ingest endpoint and the OpenTelemetry adapter.
 *
 * Returns the number of events actually persisted. Two events can legitimately
 * share a span_id within one call (e.g. a caller resending a batch, or a
 * malformed client emitting more than one envelope per span) — the
 * (org_id, run_id, span_id) upsert then keeps only the first and silently
 * drops the rest via ignoreDuplicates. Callers that report ingest success back
 * to the SDK/caller must use this count, not events.length, or they claim a
 * complete trace record when part of it was actually discarded.
 */
export async function storeEvents(
  events: TraceEvent[],
  projectId: string,
  orgId: string | null = null
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;

  // A run belongs to an org — (org_id, run_id) is its identity and org_id is
  // NOT NULL. Without this the insert fails deep in PostgREST with a bare
  // null-constraint violation that says nothing about the actual cause: an API
  // key created before tenancy existed and never assigned to an org.
  if (!orgId) {
    throw new Error(
      "This API key is not attached to an organisation, so its runs cannot be stored. " +
      "Assign the key to an org (api_keys.org_id) or issue a new key from the dashboard."
    );
  }

  // Group by run (usually one run per batch).
  const byRun = new Map<string, TraceEvent[]>();
  for (const e of events) {
    const arr = byRun.get(e.run_id) ?? [];
    arr.push(e);
    byRun.set(e.run_id, arr);
  }

  let persisted = 0;

  for (const [runId, runEvents] of byRun) {
    const start = runEvents.find(
      (e): e is RunEvent => e.type === "run" && e.phase === "start"
    );
    const end = runEvents.find(
      (e): e is RunEvent => e.type === "run" && e.phase === "end"
    );

    // 0. Tenant guard: if this run_id already exists under a DIFFERENT project/org,
    //    refuse to attach these events. The run row is owned by its first writer
    //    (ignoreDuplicates below never reassigns it), so without this a caller who
    //    learns another tenant's run_id (or sets a colliding OTel traceId) could
    //    inject events into that run and poison its replay/digest.
    const { data: existingRun } = await supabase
      .from("ad_runs")
      .select("project_id, org_id")
      .eq("run_id", runId)
      .maybeSingle();
    if (
      existingRun &&
      (existingRun.project_id !== projectId || (existingRun.org_id ?? null) !== (orgId ?? null))
    ) {
      console.warn(`[ingest] run_id ${runId} is owned by another tenant — rejecting ${runEvents.length} event(s)`);
      continue;
    }

    // 1. Guarantee the run row exists (FK target). Never overwrites.
    // Conflict target is (org_id, run_id): run ids are unique per tenant now,
    // not globally, so "run_id" alone no longer names a constraint.
    const { error: runErr } = await supabase.from("ad_runs").upsert(
      {
        run_id: runId,
        project_id: projectId,
        org_id: orgId,
        name: start?.name ?? "agent",
        status: "running",
      },
      { onConflict: "org_id,run_id", ignoreDuplicates: true }
    );
    if (runErr) throw new Error(`could not create run ${runId}: ${runErr.message}`);

    // 2. Enrich from the start envelope.
    if (start) {
      let startQ = supabase
        .from("ad_runs")
        .update({
          name: start.name,
          input: start.input ?? null,
          metadata: start.metadata ?? {},
          started_at: start.ts_start,
          actor_type: start.actor?.type ?? null,
          actor_id: start.actor?.id ?? null,
        })
        .eq("run_id", runId);
      if (orgId) startQ = startQ.eq("org_id", orgId);
      await startQ;

      // Wire agent-to-agent stitching: if the start event carries parent_run_id in
      // metadata, link this run to its orchestrator (tenant-guarded inside).
      const parentRunId = (start.metadata as Record<string, unknown> | undefined)?.parent_run_id;
      if (parentRunId && typeof parentRunId === "string" && orgId) {
        const { setParentRunId } = await import("@/lib/multiAgent");
        await setParentRunId(runId, parentRunId, orgId).catch(() => {});

        // A caller MAY additionally declare metadata.scope — the tool-name
        // patterns this subagent is authorized to call. Absent or malformed,
        // this defaults to ["*"] (unrestricted), the same behavior every
        // delegation had before scope existed — so this is opt-in, not a
        // breaking change for existing SDK integrations. See lib/trust.ts's
        // attestDelegation for why this is the only place a real scope
        // value can enter the signed, hash-chained attestation.
        const rawScope = (start.metadata as Record<string, unknown> | undefined)?.scope;
        const scope =
          Array.isArray(rawScope) && rawScope.length > 0 && rawScope.every((s) => typeof s === "string")
            ? (rawScope as string[])
            : ["*"];
        const { attestDelegation } = await import("@/lib/trust");
        await attestDelegation(orgId, parentRunId, runId, scope).catch(() => {});
      }
    }

    // 3. Insert events; idempotent on (run_id, span_id).
    const rows = runEvents.map((e) => ({
      org_id: orgId,
      run_id: e.run_id,
      span_id: e.span_id,
      parent_span_id: e.parent_span_id,
      seq: e.seq,
      type: e.type,
      ts_start: e.ts_start,
      ts_end: e.ts_end,
      latency_ms: "latency_ms" in e ? e.latency_ms : null,
      model_id: e.type === "llm" ? e.model.model_id : null,
      tool_name: e.type === "tool" ? e.tool_name : null,
      tool_call_id: e.type === "tool" ? e.tool_call_id : null,
      total_tokens: e.type === "llm" ? e.usage?.total_tokens ?? null : null,
      error: "error" in e ? e.error : null,
      policy_evaluated: e.type === "tool" ? (e.policy_evaluated != null) : null,
      policy_blocked: e.type === "tool" ? (e.policy_block != null) : null,
      actor_type: e.actor?.type ?? null,
      actor_id: e.actor?.id ?? null,
      data: e,
    }));
    // (org_id, run_id, span_id) — run ids are per-tenant now, so the old
    // "run_id,span_id" conflict target no longer names a constraint and the
    // upsert would fail outright.
    //
    // .select("span_id") turns this into `... ON CONFLICT DO NOTHING RETURNING
    // span_id` — rows skipped as duplicates are NOT returned, so the length of
    // the result is the true number of rows persisted, unlike rows.length
    // (the number attempted).
    const { data: insertedRows, error: evErr } = await supabase
      .from("ad_events")
      .upsert(rows, { onConflict: "org_id,run_id,span_id", ignoreDuplicates: true })
      .select("span_id");
    if (evErr) throw new Error(`could not store events for run ${runId}: ${evErr.message}`);
    persisted += insertedRows?.length ?? rows.length;

    // 4. Close out on the end envelope.
    if (end) {
      const status = end.status ?? "success";
      const endMeta = end.metadata as Record<string, unknown> | undefined;
      const redactionCount = endMeta?.redaction_count;
      const redactionByType = endMeta?.redaction_by_type;
      let endQ = supabase
        .from("ad_runs")
        .update({
          status,
          output: end.output ?? null,
          error: end.error ?? null,
          ended_at: end.ts_end ?? end.ts_start,
          ...(typeof redactionCount === "number" ? { redaction_count: redactionCount } : {}),
          ...(redactionByType && typeof redactionByType === "object" ? { redaction_by_type: redactionByType } : {}),
        })
        .eq("run_id", runId);
      if (orgId) endQ = endQ.eq("org_id", orgId);
      await endQ;

      // Fire alert rules for this org (Enterprise feature; gated inside).
      //
      // Both this and the PLG events below used to fire un-awaited with no
      // after()/waitUntil() — on Vercel's Node runtime, a detached promise
      // isn't guaranteed to run to completion once the handler's response is
      // sent, so an alert rule or a PLG lifecycle event could silently never
      // fire. after() keeps ingest's own response latency unchanged while
      // guaranteeing these actually run.
      // Routed through lib/alertHook rather than importing the licensed
      // alerting engine directly, so this Community file compiles without it.
      after(() => evaluateRunAlerts(orgId, { run_id: runId, name: end.name ?? "agent", status }));

      // PLG lifecycle events (best-effort, never block ingest).
      if (orgId) {
        const { firePlgEvent } = await import("@/lib/plg");
        const plgMeta = { run_name: end.name ?? "agent", run_id: runId };
        after(() => firePlgEvent(orgId, "first_run_captured", plgMeta).catch(() => {}));
        if (status === "error") {
          after(() => firePlgEvent(orgId, "first_error_caught", plgMeta).catch(() => {}));
        }
      }
    }

    // 5. Recompute aggregates + the cassette digest from persisted rows
    //    (idempotent under retries). The digest is captured here so whole-run
    //    re-execution can later prove the stored events still reproduce it.
    const { data: agg } = await supabase
      .from("ad_events")
      .select("data,type,total_tokens")
      .eq("org_id", orgId)
      .eq("run_id", runId)
      .order("seq", { ascending: true }).limit(MAX_ROWS);
    if (agg) {
      const stepCount = agg.filter((r: { type: string }) => r.type === "llm").length;
      const totalTokens = agg.reduce(
        (sum: number, r: { total_tokens: number | null }) => sum + (r.total_tokens ?? 0),
        0
      );
      let aggUpdateQ = supabase.from("ad_runs").update({ step_count: stepCount, total_tokens: totalTokens }).eq("run_id", runId);
      if (orgId) aggUpdateQ = aggUpdateQ.eq("org_id", orgId);
      await aggUpdateQ;

      // Capture the oracle-stream digest separately — best-effort so a missing
      // cassette_digest column (migration lag) never breaks ingest.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allEvents = agg.map((r: any) => r.data).filter(Boolean) as TraceEvent[];
      if (allEvents.length) {
        const chain = cassetteChainFromEvents(allEvents);
        const digest = chain.digest;
        let digestQ = supabase.from("ad_runs").update({ cassette_digest: digest }).eq("run_id", runId);
        if (orgId) digestQ = digestQ.eq("org_id", orgId);
        await digestQ;
        // Store the per-step chain so a tampered run can be pinpointed to the exact
        // entry. Separate, bounded, best-effort write — a missing column (migration
        // lag) or an oversized chain never affects the digest write above.
        if (chain.steps.length && chain.steps.length <= 4000) {
          let chainQ = supabase.from("ad_runs").update({ cassette_chain: chain.steps }).eq("run_id", runId);
          if (orgId) chainQ = chainQ.eq("org_id", orgId);
          await chainQ;
        }
        // Golden suite: auto-enroll a bad run as a permanent regression test (deduped).
        if (end && orgId) {
          const { enrollIfBad } = await import("@/lib/golden");
          await enrollIfBad(orgId, runId, end.name ?? "agent", allEvents, digest).catch(() => {});
        }
      }
    }

    // 6. On run-end: increment the day/agent rollup (so the dashboard reads
    //    tens of rows, not millions) and append to the tamper-evident ledger.
    //    Both best-effort — never block ingest if a migration is lagging.
    if (end && orgId) {
      const status = end.status ?? "success";
      if (status === "success" || status === "error") {
        const dayIso = (start?.ts_start ?? end.ts_end ?? end.ts_start ?? "").slice(0, 10);
        let latMs = 0, latCnt = 0;
        if (start?.ts_start && (end.ts_end ?? end.ts_start)) {
          const ms = new Date(end.ts_end ?? end.ts_start!).getTime() - new Date(start.ts_start).getTime();
          if (ms >= 0 && ms < 3600_000) { latMs = Math.round(ms); latCnt = 1; }
        }
        const { data: row } = await supabase.from("ad_runs").select("total_tokens").eq("org_id", orgId).eq("run_id", runId).maybeSingle();
        if (dayIso) {
          await supabase.rpc("bump_rollup", {
            p_org: orgId, p_day: dayIso, p_agent: end.name ?? "agent",
            p_runs: 1, p_err: status === "error" ? 1 : 0, p_succ: status === "success" ? 1 : 0,
            p_tok: row?.total_tokens ?? 0, p_lat_sum: latMs, p_lat_cnt: latCnt,
          });
        }
      }
      const { appendToLedger } = await import("@/lib/ledger");
      await appendToLedger(orgId, runId);
    }
  }

  return persisted;
}

/**
 * Resolve an API key (raw Bearer token) to its project id, or null if invalid.
 * SHA-256 hash lookup against api_keys. Shared by every ingest surface.
 */
export interface ResolvedKey {
  projectId: string;
  orgId: string | null;
}

export async function resolveApiKey(rawKey: string | null): Promise<ResolvedKey | null> {
  if (!rawKey) return null;
  const crypto = await import("crypto");
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data } = await supabase
    .from("api_keys")
    .select("id, org_id, expires_at, scope")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .single();
  if (!data?.id) return null;
  // Reject compliance_read, security_findings and scim keys — each is scoped to
  // its own endpoint and must never be able to ingest run data. "trace_write"
  // is accepted here and rejected by getCaller(), which is precisely what makes
  // it write-only: it can send telemetry and reach nothing else.
  if (data.scope && !INGEST_SCOPES.includes(data.scope as ApiKeyScope)) return null;
  // Reject expired keys. expires_at NULL = perpetual (existing keys unaffected).
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  // Best-effort last_used_at stamp — deliberately not awaited so it never blocks
  // the ingest hot path. tryWrite logs a rejected write instead of dropping it.
  tryWrite(
    supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id),
    "stamp api key last_used_at"
  ).catch((e) => console.error("[ingest] last_used_at stamp threw:", e));
  return { projectId: data.id, orgId: data.org_id ?? null };
}
