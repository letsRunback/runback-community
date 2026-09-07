import { ulid } from "ulid";
import { createRedactor, type Redactor, type RedactOptions } from "@runback/redact";
import { chainStep, sha256, oracleEntryOf } from "@runback/replay";
import {
  SCHEMA_VERSION,
  type TraceEvent,
  type LlmEvent,
  type ToolEvent,
  type RunEvent,
  type EnvEvent,
  type TraceError,
  type KeyProjection,
} from "@runback/schema";
import { enterEnvCaptureOrThrow, type EnvKind, type EnvSink } from "./envHook.js";
import { enforcePolicy, type PolicyRule, type PendingCall, type EnforcementDecision } from "@runback/policy";
import type { BypassGuardOptions } from "./bypassGuard.js";

/** Outcome of a single ingest POST. */
export interface FlushResult {
  /** true only when the events reached the collector and it accepted them. */
  ok: boolean;
  /** How many events were accepted. 0 whenever ok is false. */
  sent: number;
  /** Human-readable reason, present only on failure. */
  error: string | null;
}

/** Outcome of finish() — whether this run was actually recorded. */
export interface FinishResult extends FlushResult {
  runId: string;
  /** Where the events were sent, so a misconfigured origin is visible. */
  ingestUrl: string;
}

export interface CollectorOptions {
  runName: string;
  /** The initial task/input given to the agent. */
  input?: unknown;
  /** Arbitrary tags (sdk version, git sha, env) stored on the run. */
  tags?: Record<string, unknown>;
  /**
   * Who or what is driving this run — stamped on every event unless a call
   * site sets its own `actor` explicitly. e.g. `{ type: "user", id: session.userId }`
   * for a multi-tenant agent, or `{ type: "api_key", id: apiKeyId }` for a
   * service. Optional — omit for single-actor/internal automation.
   */
  actor?: { type: "user" | "api_key" | "system"; id: string; label?: string };
  /** Override the ingest base URL. Defaults to RUNBACK_INGEST_URL or localhost. */
  ingestUrl?: string;
  /** Override the API key. Defaults to RUNBACK_API_KEY. */
  apiKey?: string;
  /** Flush automatically once this many events are buffered. */
  flushAt?: number;
  /**
   * Redact secrets/PII from every event BEFORE it leaves the process.
   * `true` or `"standard"` = high-confidence detectors; `"strict"` adds phone/IP;
   * or pass full {@link RedactOptions}. Standard-tier redaction is ON by
   * default — pass `false` to disable. (Kept as an option, not mandatory,
   * because a self-hosted/air-gapped deployment where nothing ever leaves
   * your own perimeter may legitimately want the raw, unredacted payload for
   * debugging — but the default path is the safe one.)
   */
  redact?: boolean | "standard" | "strict" | RedactOptions;
  /**
   * Capture environment nondeterminism (clock, randomness, UUIDs, fetch) in-process
   * so the run can be replayed byte-exact — not just at LLM/tool grain. Off by
   * default; opt in for the deterministic-replay substrate. See
   * docs/DEEP_REPLAY_SPEC.md. Tool and model calls stay opaque (their outputs are
   * the oracle); only your agent's own reads are recorded.
   */
  captureEnv?: boolean;
  /**
   * Salience projection (H2): per-tool / per-model rules that normalize an input
   * before it is content-addressed, so the same logical call keys identically
   * across runs even when volatile fields (request ids, timestamps, nonces)
   * differ. e.g. { tools: { search: { drop: ["request_id"] } } }. Applied at
   * capture AND recorded on the event so the server reproduces the exact key.
   */
  keyProjection?: {
    tools?: Record<string, KeyProjection>;
    model?: KeyProjection;
  };
  /**
   * Runtime enforcement: policy rules evaluated as a PRE-HOOK before each tool
   * runs. A violating action is BLOCKED (the tool never executes) and recorded as
   * a re-runnable proof. In-process and synchronous — no network in the agent's
   * critical path. e.g. block a refund unless escalate_to_human ran first.
   */
  enforce?: PolicyRule[];
  /**
   * What happens when the policy check ITSELF throws (a bug in a rule, bad
   * input shape, etc — not "the policy evaluated and denied", but "the
   * evaluation machinery broke"). `false` (default) fails open — the action
   * is allowed, because a broken guardrail blocking every tool call is worse
   * than a broken guardrail missing one. Set `true` to fail closed instead —
   * the action is blocked and recorded as a policy_block event — for
   * environments where an unenforced action is the worse outcome (e.g. a
   * regulated write path where "nothing ran" beats "ran ungoverned"). Only
   * meaningful when `enforce` is also set — with no rules there's nothing to
   * evaluate, so nothing can throw.
   */
  failClosed?: boolean;
  /**
   * Detect (and optionally block) a model-provider call made OUTSIDE this
   * withDebugger's instrumentation — the SDK-integration equivalent of what
   * gateway mode's credential isolation closes for base-URL-swap agents
   * (see packages/gateway). `true` installs with defaults (mode: "observe" —
   * reports, never blocks, matching the runtime policy gate's own fail-open
   * default). Pass an options object for `mode: "block"` or a custom
   * hostname list. Off by default — installBypassGuard() patches
   * globalThis.fetch process-wide, which is a real enough side effect that
   * it shouldn't happen silently. See bypassGuard.ts.
   */
  enforceCapture?: boolean | BypassGuardOptions;
  /**
   * Live-ish kill-switch: poll Runback for whether this agent's authorization
   * has been revoked, and block tool calls the moment it has — same
   * mechanism as `enforce`/`recordPolicyBlock`, a different trigger. A
   * revocation is decided server-side from sampled behavioral drift (a
   * Pro/Enterprise "guard" capability — see web/lib/guard.ts and
   * web/app/api/cron/adversarial-guard), not by anything the SDK evaluates
   * itself.
   *
   * Off by default — an extra background network poll and an opt-in server
   * capability, not something every integration should pay for silently.
   * The check is cached locally between polls (`pollMs`, default 10s), so
   * `enforceToolCall` itself stays synchronous and adds no latency to the
   * agent's hot path — only the interval timer does network I/O. Latency
   * floor for an actual revocation taking effect is `pollMs` plus the
   * server's own check interval: "revoked within the polling window",
   * never sub-second. A poll failure (network, server down) fails OPEN —
   * the agent is never blocked because Runback was unreachable.
   *
   * Runs a `setInterval` for the process's lifetime unless `finish()` is
   * called (which clears it) — not a fit for a short-lived serverless
   * invocation that never calls `finish()` before terminating; a fit for a
   * long-running agent process or worker.
   */
  guard?: boolean | { agentName?: string; pollMs?: number };
}

function toTraceError(err: unknown): TraceError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "Error", message: String(err) };
}

/**
 * Owns one run's identity and buffers trace events, flushing them to the ingest
 * endpoint. Every public method is internally guarded — instrumentation must
 * never throw into the user's agent.
 */
export class Collector implements EnvSink {
  readonly runId = ulid();
  private seq = 0;
  private buffer: TraceEvent[] = [];
  /** EnvSink: >0 while inside the SDK's own work, a tool, or a model call — capture is opaque then. */
  envDepth = 0;
  /** Runtime-enforcement rules + the accumulating tool-call history they read. */
  private readonly enforceRules: PolicyRule[];
  private readonly failClosed: boolean;
  private readonly priorToolCalls: PendingCall[] = [];
  private readonly inputText: string;
  private readonly opts: CollectorOptions;
  private readonly ingestUrl: string;
  private readonly apiKey: string | undefined;
  private readonly flushAt: number;
  /** span_id of the most recently recorded LLM call — parent for its tool spans. */
  lastLlmSpanId: string | null = null;
  private rootSpanId: string;
  private readonly redactor: Redactor | null;
  /** Running oracle-stream chain — the deterministic cassette digest at capture time. */
  private cassettePrev = "";
  private cassetteCount = 0;
  /** Feature #5 MVP kill-switch — see the `guard` CollectorOptions doc. */
  private revoked = false;
  private revokedReason: string | null = null;
  private guardTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: CollectorOptions) {
    this.opts = opts;
    // Default to standard-tier redaction ON. It used to default off — the
    // integration path an integrator reaches by just calling withDebugger()
    // with no options sent secrets/PII unredacted, while /security described
    // scrubbing as if automatic ("before a trace is sent anywhere"). A
    // security/audit product's default path should be the safe one; pass
    // `redact: false` explicitly to opt out.
    this.redactor = createRedactor(opts.redact ?? true);
    // The default stays localhost on purpose: the SDK must never phone home to
    // runback.dev by accident, which is what makes a self-hosted or air-gapped
    // deployment safe by construction.
    //
    // The cost of that choice was paid by hosted users, silently. Nothing in
    // the quick start set RUNBACK_INGEST_URL, so their events POSTed to
    // localhost:3000, ECONNREFUSED was a console.warn, and finish() returned
    // undefined either way — the agent ran normally while capturing nothing.
    // For an audit-trail product, believing you have a record when you do not
    // is the worst available outcome.
    const explicitUrl = opts.ingestUrl ?? process.env.RUNBACK_INGEST_URL;
    this.ingestUrl = (explicitUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = opts.apiKey ?? process.env.RUNBACK_API_KEY;

    // A hosted key aimed at localhost is a misconfiguration every time. Say so
    // once, up front, instead of letting it surface as an empty dashboard.
    if (!explicitUrl && this.apiKey?.startsWith("rb_live_")) {
      console.warn(
        "[runback] RUNBACK_INGEST_URL is not set, so events will be sent to " +
          "http://localhost:3000 — but your API key is a hosted key. Set " +
          "RUNBACK_INGEST_URL=https://runback.dev (or your self-host origin), " +
          "or nothing will be recorded."
      );
    }
    this.flushAt = opts.flushAt ?? 25;
    this.rootSpanId = ulid();
    this.enforceRules = opts.enforce ?? [];
    this.failClosed = opts.failClosed ?? false;
    this.inputText = typeof opts.input === "string" ? opts.input : opts.input != null ? JSON.stringify(opts.input) : "";

    // Run-start envelope (seq 0).
    const ev: RunEvent = {
      schema_version: SCHEMA_VERSION,
      run_id: this.runId,
      span_id: this.rootSpanId,
      parent_span_id: null,
      seq: this.next(),
      ts_start: new Date().toISOString(),
      ts_end: null,
      type: "run",
      phase: "start",
      name: opts.runName,
      input: opts.input ?? null,
      output: null,
      status: "running",
      error: null,
      metadata: opts.tags ?? {},
    };
    this.push(ev);

    // Activate environment capture AFTER the start envelope (so the SDK's own
    // setup reads aren't recorded). From here, the agent's clock/random/uuid/fetch
    // reads in this async context are captured; SDK-internal reads stay opaque
    // because every recording method brackets itself with envDepth.
    if (opts.captureEnv) enterEnvCaptureOrThrow(this);

    if (opts.guard) this.startGuardPoll(opts.guard);
  }

  private startGuardPoll(guard: true | { agentName?: string; pollMs?: number }): void {
    const agentName = (typeof guard === "object" && guard.agentName) || this.opts.runName;
    const pollMs = (typeof guard === "object" && guard.pollMs) || 10_000;
    const poll = async () => {
      if (!this.apiKey) return;
      try {
        const res = await fetch(
          `${this.ingestUrl}/api/agents/authorization-status?agent_name=${encodeURIComponent(agentName)}`,
          { headers: { authorization: `Bearer ${this.apiKey}` } }
        );
        // Fail OPEN on any non-2xx or network error — a guard endpoint that's
        // down, misconfigured, or rate-limiting must never be the reason an
        // agent's legitimate tool calls start failing.
        if (!res.ok) return;
        const data = (await res.json()) as { revoked?: boolean; reason?: string | null };
        this.revoked = !!data.revoked;
        this.revokedReason = data.reason ?? null;
      } catch {
        /* fail open */
      }
    };
    void poll();
    this.guardTimer = setInterval(() => void poll(), pollMs);
    // Never keep a process alive purely to keep polling — a long-running
    // agent that calls finish() clears this explicitly; anything else should
    // exit on its own schedule, not be held open by this timer.
    this.guardTimer.unref?.();
  }

  private next(): number {
    return this.seq++;
  }

  /** EnvSink: record one captured environment boundary as an EnvEvent. */
  recordEnv(kind: EnvKind, key: string, output: unknown): void {
    // Bracket so the ulid()/seq machinery here is itself opaque to capture.
    this.envDepth++;
    try {
      const ev: EnvEvent = {
        schema_version: SCHEMA_VERSION,
        run_id: this.runId,
        span_id: ulid(),
        parent_span_id: this.lastLlmSpanId ?? this.rootSpanId,
        seq: this.next(),
        ts_start: new Date().toISOString(),
        ts_end: null,
        type: "env",
        kind,
        key,
        output,
      };
      this.push(ev);
    } catch {
      /* never throw into the agent */
    } finally {
      this.envDepth--;
    }
  }

  private push(ev: TraceEvent) {
    try {
      // Single chokepoint: stamp the default actor (unless a call site already
      // set its own), then redact, before the event is buffered or sent anywhere.
      // If redaction throws, drop the event rather than risk leaking unredacted data.
      if (this.opts.actor && !ev.actor) ev.actor = this.opts.actor;
      let out = ev;
      if (this.redactor) {
        try {
          out = this.redactor.redactEvent(ev);
        } catch {
          return;
        }
      }
      this.buffer.push(out);
      // Advance the capture-time oracle chain through the SAME oracleEntryOf used by
      // cassetteDigestFromEvents and reexecuteRun — so the capture-time digest, the
      // server digest, and the verification digest are identical by construction
      // (llm + tool oracle AND env reads; run/reasoning envelopes are skipped).
      const entry = oracleEntryOf(out);
      if (entry) {
        this.cassettePrev = chainStep(this.cassettePrev, entry);
        this.cassetteCount++;
      }
      if (this.buffer.length >= this.flushAt) void this.flush();
    } catch {
      /* never throw into the agent */
    }
  }

  /** Record a completed (or failed) LLM call. Returns the new span_id. */
  recordLlm(ev: Omit<LlmEvent, keyof EventEnvelope> & Partial<EventEnvelope>): string {
    this.envDepth++; // SDK-internal reads (ulid, Date) stay opaque to env capture
    const spanId = ulid();
    try {
      const proj = this.opts.keyProjection?.model;
      const full: LlmEvent = {
        ...(ev as LlmEvent),
        schema_version: SCHEMA_VERSION,
        run_id: this.runId,
        span_id: spanId,
        parent_span_id: this.rootSpanId,
        seq: this.next(),
        type: "llm",
        ...(proj ? { key_projection: proj } : {}),
      };
      this.lastLlmSpanId = spanId;
      this.push(full);
    } catch {
      /* swallow */
    } finally {
      this.envDepth--;
    }
    return spanId;
  }

  /** Record a tool execution (success or error). */
  recordTool(args: {
    tool_name: string;
    tool_call_id: string;
    input: unknown;
    output: unknown | null;
    latency_ms: number | null;
    error: unknown | null;
    ts_start: string;
    /** True when enforceToolCall actually evaluated a ruleset and passed this call. */
    policyEvaluated?: boolean;
    /** Override the collector-level default actor for just this event. */
    actor?: { type: "user" | "api_key" | "system"; id: string; label?: string };
  }) {
    this.envDepth++;
    try {
      const proj = this.opts.keyProjection?.tools?.[args.tool_name];
      const ev: ToolEvent = {
        schema_version: SCHEMA_VERSION,
        run_id: this.runId,
        span_id: ulid(),
        parent_span_id: this.lastLlmSpanId,
        seq: this.next(),
        ts_start: args.ts_start,
        ts_end: new Date().toISOString(),
        type: "tool",
        tool_name: args.tool_name,
        tool_call_id: args.tool_call_id,
        input: args.input,
        output: args.output,
        latency_ms: args.latency_ms,
        error: args.error == null ? null : toTraceError(args.error),
        ...(args.actor ? { actor: args.actor } : {}),
        ...(proj ? { key_projection: proj } : {}),
        ...(args.policyEvaluated ? { policy_evaluated: { passed: true } } : {}),
      };
      this.push(ev);
    } catch {
      /* swallow */
    } finally {
      this.envDepth--;
    }
  }

  /**
   * Runtime-enforcement pre-hook. Decide whether a pending tool call is allowed
   * given the calls already made. Records a tamper-evident block event when it
   * isn't, and does NOT add a blocked call to the history (it never ran).
   */
  enforceToolCall(toolName: string, input: unknown): EnforcementDecision {
    if (this.revoked) {
      // Checked before the local enforceRules path: a revocation is a
      // separate, server-decided trigger (sampled drift over threshold),
      // not a rule this ruleset could express. Recorded the same way a
      // local policy block is — a real, hash-chained, re-runnable event —
      // so "why did this agent stop working" is answerable from the trace,
      // not just a support ticket.
      const decision: EnforcementDecision = {
        allowed: false,
        rule: "authorization_revoked",
        detail: this.revokedReason ?? "This agent's authorization was revoked.",
        evaluated: true,
      };
      this.recordPolicyBlock(toolName, input, decision);
      return decision;
    }
    if (this.enforceRules.length === 0) {
      this.priorToolCalls.push({ tool_name: toolName, input });
      return { allowed: true, rule: null, detail: null, evaluated: false };
    }
    let decision: EnforcementDecision;
    try {
      decision = enforcePolicy(this.enforceRules, this.priorToolCalls, { tool_name: toolName, input }, this.inputText);
    } catch (err) {
      // The evaluation machinery itself threw — not "policy denied", but
      // "the guardrail broke". Default (failClosed: false) is fail-open: a
      // broken policy must never block the agent. Set failClosed: true to
      // block instead, for paths where an unenforced action is the worse
      // outcome. Either way `evaluated: false` — this was never real
      // evidence the policy ran, only that it errored.
      decision = this.failClosed
        ? { allowed: false, rule: "enforcement_error", detail: `policy evaluation threw: ${err instanceof Error ? err.message : String(err)}`, evaluated: false }
        : { allowed: true, rule: null, detail: null, evaluated: false };
    }
    if (decision.allowed) {
      this.priorToolCalls.push({ tool_name: toolName, input });
    } else {
      this.recordPolicyBlock(toolName, input, decision);
    }
    return decision;
  }

  /** Rule name → count, from this.redactor's itemized log — the compact shape sent to the server. */
  private redactionByType(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const entry of this.redactor?.log() ?? []) out[entry.rule] = (out[entry.rule] ?? 0) + 1;
    return out;
  }

  /** Record a blocked action as a first-class, hash-chained, re-runnable event. */
  private recordPolicyBlock(toolName: string, input: unknown, decision: EnforcementDecision) {
    this.envDepth++;
    try {
      const ev: ToolEvent = {
        schema_version: SCHEMA_VERSION,
        run_id: this.runId,
        span_id: ulid(),
        parent_span_id: this.lastLlmSpanId,
        seq: this.next(),
        ts_start: new Date().toISOString(),
        ts_end: new Date().toISOString(),
        type: "tool",
        tool_name: toolName,
        tool_call_id: "",
        input,
        output: null,
        latency_ms: 0,
        error: { name: "PolicyBlock", message: decision.detail ?? "blocked by policy" },
        policy_block: { rule: decision.rule ?? "policy", detail: decision.detail ?? "blocked by policy" },
        policy_evaluated: { passed: false },
      };
      this.push(ev);
    } catch {
      /* never throw into the agent */
    } finally {
      this.envDepth--;
    }
  }

  /** Record a free-form reasoning / log marker. */
  recordReasoning(text: string, label: string | null = null) {
    this.envDepth++;
    try {
      this.push({
        schema_version: SCHEMA_VERSION,
        run_id: this.runId,
        span_id: ulid(),
        parent_span_id: this.lastLlmSpanId ?? this.rootSpanId,
        seq: this.next(),
        ts_start: new Date().toISOString(),
        ts_end: new Date().toISOString(),
        type: "reasoning",
        text,
        label,
      });
    } catch {
      /* swallow */
    } finally {
      this.envDepth--;
    }
  }

  /** The run's deterministic oracle-stream digest as captured so far. */
  cassetteDigest(): { digest: string; entry_count: number } {
    return { digest: this.cassettePrev || sha256(""), entry_count: this.cassetteCount };
  }

  /**
   * Record the run-end envelope and flush everything.
   *
   * Returns whether the run actually reached the collector. Check `.ok` if the
   * record matters — an audit trail you did not confirm is not an audit trail.
   */
  async finish(result: {
    output?: unknown;
    status?: "success" | "error";
    error?: unknown;
  }): Promise<FinishResult> {
    if (this.guardTimer) { clearInterval(this.guardTimer); this.guardTimer = null; }
    this.envDepth++;
    try {
      const ev: RunEvent = {
        schema_version: SCHEMA_VERSION,
        run_id: this.runId,
        span_id: ulid(),
        parent_span_id: this.rootSpanId,
        seq: this.next(),
        ts_start: new Date().toISOString(),
        ts_end: new Date().toISOString(),
        type: "run",
        phase: "end",
        name: this.opts.runName,
        input: null,
        output: result.output ?? null,
        status: result.status ?? (result.error ? "error" : "success"),
        error: result.error == null ? null : toTraceError(result.error),
        // Capture-time deterministic oracle digest — lets an auditor detect any
        // post-capture tampering of the events vs. what the agent actually saw.
        // redaction_count/redaction_by_type are self-reported by the SDK (the
        // server never sees the raw value, so it can't independently verify a
        // redaction happened) — same trust boundary as every other
        // client-supplied field on this event. redaction_by_type is a compact
        // rule-name → count summary, not the raw per-instance path log (which
        // stays local to the SDK via this.redactor.log() — no reason to ship
        // JSON paths over the wire when the aggregate is what's actionable).
        metadata: {
          cassette_digest: this.cassettePrev || sha256(""),
          cassette_entries: this.cassetteCount,
          redaction_count: this.redactor?.total() ?? 0,
          redaction_by_type: this.redactionByType(),
          // Same self-reported trust boundary as the redaction fields above —
          // visible here rather than a silent cap so "doesn't bloat payloads"
          // is something a customer can actually check, not just take on faith.
          truncated_fields: this.redactor?.truncatedFields() ?? 0,
        },
      };
      this.push(ev);
    } catch {
      /* swallow */
    } finally {
      this.envDepth--;
    }
    const flushed = await this.flush();
    if (this.redactor && this.redactor.total() > 0) {
      console.info(
        `[runback] redacted ${this.redactor.total()} sensitive value(s) before sending`
      );
    }
    if (this.redactor && this.redactor.truncatedFields() > 0) {
      console.info(
        `[runback] truncated ${this.redactor.truncatedFields()} oversized field(s) before sending`
      );
    }
    // finish() returned undefined on success AND on total failure, so no caller
    // could tell whether the run had been recorded. Return the outcome.
    return { ...flushed, runId: this.runId, ingestUrl: this.ingestUrl };
  }

  /**
   * POST whatever is buffered. Clears the buffer on success; keeps it on failure.
   *
   * Returns the outcome rather than swallowing it. A console.warn is invisible
   * to a program: it cannot be asserted on in a test, gated on in CI, or
   * noticed by an agent running unattended.
   */
  async flush(): Promise<FlushResult> {
    if (this.buffer.length === 0) return { ok: true, sent: 0, error: null };
    const batch = this.buffer.splice(0, this.buffer.length);
    if (!this.apiKey) {
      const error = `no RUNBACK_API_KEY set — dropped ${batch.length} events`;
      console.warn(`[runback] ${error}`);
      return { ok: false, sent: 0, error };
    }
    this.envDepth++; // our own ingest POST must never be captured as an env fetch
    try {
      const res = await fetch(`${this.ingestUrl}/api/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const error = `ingest failed ${res.status} ${text}`.trim();
        console.warn(`[runback] ${error}`);
        this.buffer.unshift(...batch); // requeue for the next flush
        return { ok: false, sent: 0, error };
      }
      return { ok: true, sent: batch.length, error: null };
    } catch (err) {
      const error = `ingest error contacting ${this.ingestUrl}: ${(err as Error).message}`;
      console.warn(`[runback] ${error}`);
      this.buffer.unshift(...batch);
      return { ok: false, sent: 0, error };
    } finally {
      this.envDepth--;
    }
  }
}

type EventEnvelope = Pick<
  TraceEvent,
  "schema_version" | "run_id" | "span_id" | "parent_span_id" | "seq" | "type"
>;
