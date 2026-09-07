/**
 * Runback trace-event wire format — v1.
 *
 * Design principles (these are load-bearing; read before changing):
 *  1. FLAT event stream, not a nested tree. Events carry `parent_span_id` and the
 *     tree is reconstructed on the client. A flat stream ingests incrementally,
 *     survives partial failures, and keeps an OpenTelemetry export path open.
 *  2. DISCRIMINATED UNION on `type` — one exhaustively-switchable renderer type.
 *  3. EVERYTHING ADDRESSABLE — every event has a stable (`run_id`, `span_id`) so a
 *     future "replay from step N" / "breakpoint on span X" has a durable anchor.
 *
 * Append-only contract: never repurpose a field, only add OPTIONAL ones, and bump
 * `schema_version` for breaking changes.
 */

export type SchemaVersion = 1;
export const SCHEMA_VERSION: SchemaVersion = 1;

export interface TraceError {
  name: string;
  message: string;
  stack?: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** string OR a content-parts array (multimodal / tool-result parts). */
  content: unknown;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema for the tool's parameters, as exposed to the model. */
  parameters: unknown;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * Salience projection (H2) — how a tool/model call's input is normalized BEFORE
 * it is content-addressed, so the same logical call keys identically across runs
 * even when volatile fields differ (request ids, timestamps, nonces). Carried on
 * the event so the server reproduces the exact projection and recomputes the key
 * from the RAW input — altering a salient field still breaks the chain; declared-
 * volatile fields are simply excluded from identity. Dot-paths, array-aware.
 * Absent ⇒ the key is computed over the raw input, exactly as before.
 */
export interface KeyProjection {
  /** Top-level allowlist: keep only these top-level fields when keying (subtrees intact). */
  keep?: string[];
  /** Dot-path denylist (array-aware): drop these volatile fields anywhere before keying. */
  drop?: string[];
}

export interface BaseEvent {
  schema_version: SchemaVersion;
  /** One agent invocation. */
  run_id: string;
  /** Unique id for THIS event (ULID — lexicographically sortable). */
  span_id: string;
  /** Tree reconstruction. `null` = root. */
  parent_span_id: string | null;
  /** Monotonic per-run ordering. Survives clock skew; use this to sort, not timestamps. */
  seq: number;
  /** ISO 8601. */
  ts_start: string;
  /** ISO 8601, or `null` while in-flight (forward-compat for live streaming). */
  ts_end: string | null;
  type: TraceEvent["type"];
  /**
   * Who or what triggered THIS event — a specific end-user, a service/API-key
   * identity, or an automated schedule. Optional and self-reported by the
   * caller (like `tags`); set once per Collector via CollectorOptions.actor,
   * or overridden per call. Answers "who caused this decision," not just
   * "what happened."
   */
  actor?: { type: "user" | "api_key" | "system"; id: string; label?: string };
}

/** A single call to a language model. The `request` field is the whole point of Runback. */
export interface LlmEvent extends BaseEvent {
  type: "llm";
  model: { provider: string; model_id: string };
  /**
   * THE money field — the exact context window the model saw (request side).
   * Captured verbatim at the `wrapLanguageModel` middleware boundary, NOT
   * reconstructed from response callbacks.
   */
  request: {
    system: string | null;
    messages: ModelMessage[];
    tools: ToolDefinition[];
    params: {
      temperature?: number;
      max_output_tokens?: number;
      top_p?: number;
    };
  };
  response: {
    text: string | null;
    reasoning: string | null;
    finish_reason: string | null;
    tool_calls: { tool_call_id: string; tool_name: string; input: unknown }[];
  };
  usage: TokenUsage | null;
  latency_ms: number | null;
  error: TraceError | null;
  /** Optional salience projection applied when content-addressing this request. */
  key_projection?: KeyProjection;
  /**
   * Free-form, self-reported context — e.g. which graph node/step this call
   * happened inside, for a framework (LangGraph and similar) whose execution
   * unit is bigger than one LLM call. Mirrors RunEvent.metadata; absent for
   * every existing integration, so this is purely additive.
   */
  metadata?: Record<string, unknown>;
}

/** A tool/function invocation requested by an LLM step. */
export interface ToolEvent extends BaseEvent {
  type: "tool";
  tool_name: string;
  /** Links back to the LlmEvent.response.tool_calls entry that requested it. */
  tool_call_id: string;
  input: unknown;
  /** Result, or `null` if it errored / is in-flight. */
  output: unknown | null;
  latency_ms: number | null;
  /** The tool threw — the #1 thing developers debug. */
  error: TraceError | null;
  /** Optional salience projection applied when content-addressing this input. */
  key_projection?: KeyProjection;
  /**
   * Set when a runtime policy guardrail BLOCKED this action before it ran — the
   * tool never executed (`output` is null). A first-class, hash-chained, re-runnable
   * record that the control fired: "we stopped it, and here's the proof".
   */
  policy_block?: { rule: string; detail: string };
  /**
   * Set whenever a runtime policy check actually ran against this call before
   * it executed — evidence the enforcement engine evaluated it, not just that
   * it was blocked. `passed: false` calls also carry `policy_block` above.
   */
  policy_evaluated?: { passed: boolean };
  /** Free-form, self-reported context — see LlmEvent.metadata. */
  metadata?: Record<string, unknown>;
}

/** A reasoning / log marker — manually emitted or extracted from a step. */
export interface ReasoningEvent extends BaseEvent {
  type: "reasoning";
  text: string;
  label: string | null;
  /**
   * Graph-node identity, when the source framework has one and reports it
   * (e.g. OpenInference's generic graph.node.* span attributes) — a plain
   * CHAIN/AGENT-kind span collapses to `text` alone otherwise. Absent for
   * every default integration today (including the standard LangChain/
   * LangGraph OTel instrumentor, which does not emit these attributes);
   * present when a caller's own instrumentation sets them.
   */
  graph_node?: { name: string; step?: number; graph_name?: string };
  /** Predecessor node name(s) — the routing decision, when knowable. */
  routed_from?: string[];
}

/** Run lifecycle envelope. One `start` and (usually) one `end` per run. */
export interface RunEvent extends BaseEvent {
  type: "run";
  phase: "start" | "end";
  name: string;
  input: unknown | null;
  output: unknown | null;
  status: "running" | "success" | "error" | null;
  error: TraceError | null;
  metadata: Record<string, unknown>;
}

/**
 * A nondeterminism boundary the agent crossed — a clock read, a random draw, a
 * generated UUID, or a network fetch — captured in-process by the SDK so a run can
 * be reproduced byte-exact, not just its LLM/tool oracle. The substrate of
 * deterministic replay; see docs/DEEP_REPLAY_SPEC.md.
 */
export interface EnvEvent extends BaseEvent {
  type: "env";
  kind: "now" | "date" | "random" | "uuid" | "fetch";
  /** Content address of the read (for fetch: method+url; for primitives: the kind). */
  key: string;
  /** The value handed back to the computation (the recorded oracle value). */
  output: unknown;
}

export type TraceEvent = LlmEvent | ToolEvent | ReasoningEvent | RunEvent | EnvEvent;

/** Body shape POSTed to the ingest endpoint. */
export interface IngestPayload {
  events: TraceEvent[];
}

/** Exhaustiveness helper for switch statements over `TraceEvent["type"]`. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected trace event variant: ${JSON.stringify(x)}`);
}

/**
 * What a model decided at one step — the shape a replay compares against its
 * recording to judge "same behaviour" or "diverged".
 *
 * Lives in @runback/schema, not in the replay engine that produces it, because
 * both tiers need it: the Community divergence scorer consumes it, while the
 * commercially-licensed re-execution engine constructs it. Defining it beside
 * the engine forced a Community → Enterprise import that broke a
 * Community-only build (caught by scripts/verify-community-build.sh). This is
 * the cross-package type vocabulary, so it belongs here.
 */
export interface ModelDecision {
  tool_calls: { tool_name: string; input: unknown }[];
  finish_reason: string | null;
  text: string | null;
}
