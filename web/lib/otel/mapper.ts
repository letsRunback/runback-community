/**
 * Map OTLP/HTTP trace payloads (JSON) to Runback trace events.
 *
 * Covers the conventions the common agent instrumentors emit:
 *  - OpenTelemetry GenAI semantic conventions (`gen_ai.*`)
 *  - OpenLLMetry / Traceloop indexed prompts (`gen_ai.prompt.N.*`, `gen_ai.completion.N.*`)
 *  - OpenInference / Arize (`openinference.span.kind`, `llm.*`, `input.value`/`output.value`, `tool.*`)
 *
 * A whole OTLP trace becomes one Runback run: the root span → a run envelope,
 * LLM spans → llm events, tool spans → tool events. Trees and ordering are
 * reconstructed from span ids and start times.
 */
import {
  SCHEMA_VERSION,
  type TraceEvent,
  type LlmEvent,
  type ToolEvent,
  type RunEvent,
  type ReasoningEvent,
  type ModelMessage,
} from "@runback/schema";
import { createRedactor } from "@runback/redact";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── OTLP AnyValue unwrapping ──
function anyValue(v: any): unknown {
  if (v == null || typeof v !== "object") return v;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) return (v.arrayValue?.values ?? []).map(anyValue);
  if ("kvlistValue" in v) return flattenAttrs(v.kvlistValue?.values ?? []);
  if ("bytesValue" in v) return v.bytesValue;
  return v;
}

function flattenAttrs(attrs: any[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of attrs ?? []) {
    if (a && typeof a.key === "string") out[a.key] = anyValue(a.value);
  }
  return out;
}

function nanoToIso(nano: string | number | undefined): string {
  if (nano == null) return new Date(0).toISOString();
  const ms = Number(BigInt(typeof nano === "number" ? Math.round(nano) : nano) / BigInt(1000000));
  return new Date(ms).toISOString();
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : v == null ? undefined : String(v);
}

function tryJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      /* fall through */
    }
  }
  return v;
}

interface RawSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: any[];
  status?: { code?: number; message?: string };
  events?: any[];
}

// ── classification ──
function isLlmSpan(a: Record<string, unknown>): boolean {
  const op = str(a["gen_ai.operation.name"]);
  const kind = str(a["openinference.span.kind"])?.toUpperCase();
  return (
    a["gen_ai.request.model"] != null ||
    a["gen_ai.system"] != null ||
    a["llm.model_name"] != null ||
    op === "chat" ||
    op === "text_completion" ||
    kind === "LLM"
  );
}
function isToolSpan(a: Record<string, unknown>): boolean {
  const op = str(a["gen_ai.operation.name"]);
  const kind = str(a["openinference.span.kind"])?.toUpperCase();
  return (
    op === "execute_tool" ||
    a["gen_ai.tool.name"] != null ||
    a["tool.name"] != null ||
    kind === "TOOL"
  );
}

// Non-LLM/non-tool steps that are still meaningful agent structure (a retrieval, a
// chain, a guardrail). We surface them as reasoning markers so the timeline keeps
// the run's shape — they don't enter the oracle digest, so determinism is untouched.
const AGENT_STEP_KINDS = new Set(["CHAIN", "AGENT", "RETRIEVER", "RERANKER", "GUARDRAIL", "EMBEDDING", "EVALUATOR"]);
function agentStepKind(a: Record<string, unknown>): string | null {
  const kind = str(a["openinference.span.kind"])?.toUpperCase();
  if (kind && AGENT_STEP_KINDS.has(kind)) return kind.toLowerCase();
  const op = str(a["gen_ai.operation.name"]);
  if (op && !["chat", "text_completion", "execute_tool"].includes(op)) return op;
  return null;
}

// ── graph topology (optional; spec-defined, not populated by any default
// instrumentor today) ──
//
// OpenInference defines generic graph.node.* attributes for representing
// arbitrary execution-graph topology (id/name/parent_id) —
// https://arize-ai.github.io/openinference/spec/semantic_conventions.html.
// Verified against source: the standard LangChain/LangGraph OTel instrumentor
// (openinference-instrumentation-langchain) does NOT set these — it only
// emits generic CHAIN/AGENT/TOOL/LLM span kinds with no node identity. This
// reads them for the caller who DOES set them (a custom span processor, or a
// future, more precise instrumentor) instead of silently discarding that
// structure the way every other unrecognized attribute already is.
function graphNodeFrom(a: Record<string, unknown>): { name: string } | undefined {
  const name = str(a["graph.node.name"]) ?? str(a["graph.node.id"]);
  return name ? { name } : undefined;
}
function routedFromAttr(a: Record<string, unknown>): string[] | undefined {
  const parentId = a["graph.node.parent_id"];
  if (parentId == null) return undefined;
  const names = (Array.isArray(parentId) ? parentId : [parentId]).map(str).filter((v): v is string => !!v);
  return names.length ? names : undefined;
}

function buildReasoning(span: RawSpan, a: Record<string, unknown>, kind: string): ReasoningEvent {
  const summary = str(a["input.value"] ?? a["traceloop.entity.input"] ?? a["gen_ai.prompt"]);
  const text = `[${kind}] ${span.name ?? kind}` + (summary ? `: ${summary.slice(0, 240)}` : "");
  const graph_node = graphNodeFrom(a);
  const routed_from = routedFromAttr(a);
  return {
    schema_version: SCHEMA_VERSION,
    run_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId || null,
    seq: 0,
    ts_start: nanoToIso(span.startTimeUnixNano),
    ts_end: span.endTimeUnixNano ? nanoToIso(span.endTimeUnixNano) : null,
    type: "reasoning",
    text,
    label: kind,
    ...(graph_node ? { graph_node } : {}),
    ...(routed_from ? { routed_from } : {}),
  };
}

// ── message extraction (handles the three conventions) ──
function extractMessages(a: Record<string, unknown>, span: RawSpan) {
  let system: string | null = null;
  const messages: ModelMessage[] = [];
  let responseText: string | null = null;
  let reasoning: string | null = null;
  const toolCalls: { tool_call_id: string; tool_name: string; input: unknown }[] = [];

  // (1) Traceloop / OpenLLMetry indexed attributes: gen_ai.prompt.N.{role,content}
  const promptIdx = new Set<number>();
  const complIdx = new Set<number>();
  for (const k of Object.keys(a)) {
    let m = /^gen_ai\.prompt\.(\d+)\./.exec(k);
    if (m) promptIdx.add(Number(m[1]));
    m = /^gen_ai\.completion\.(\d+)\./.exec(k);
    if (m) complIdx.add(Number(m[1]));
  }
  for (const i of [...promptIdx].sort((x, y) => x - y)) {
    const role = str(a[`gen_ai.prompt.${i}.role`]) ?? "user";
    const content = a[`gen_ai.prompt.${i}.content`];
    if (role === "system") system = (system ? system + "\n\n" : "") + (str(content) ?? "");
    else messages.push({ role: role as ModelMessage["role"], content: tryJson(content) });
  }
  for (const i of [...complIdx].sort((x, y) => x - y)) {
    const content = str(a[`gen_ai.completion.${i}.content`]);
    if (content) responseText = (responseText ? responseText + "\n" : "") + content;
    // tool calls: gen_ai.completion.N.tool_calls.M.{name,arguments,id}
    for (let j = 0; j < 16; j++) {
      const name = str(a[`gen_ai.completion.${i}.tool_calls.${j}.name`]);
      if (!name) break;
      toolCalls.push({
        tool_call_id: str(a[`gen_ai.completion.${i}.tool_calls.${j}.id`]) ?? `${i}.${j}`,
        tool_name: name,
        input: tryJson(a[`gen_ai.completion.${i}.tool_calls.${j}.arguments`]),
      });
    }
  }

  // (2) OTel span events: gen_ai.{system,user,assistant,tool}.message + gen_ai.choice
  if (messages.length === 0 && !system && span.events?.length) {
    for (const ev of span.events) {
      const ea = flattenAttrs(ev.attributes);
      const role = str(ea["gen_ai.message.role"]) ?? str(ea["role"]);
      const content = ea["content"] ?? ea["gen_ai.message.content"];
      if (ev.name === "gen_ai.system.message") system = str(content) ?? system;
      else if (ev.name === "gen_ai.choice") responseText = str(content) ?? responseText;
      else if (typeof ev.name === "string" && ev.name.startsWith("gen_ai.")) {
        messages.push({ role: (role ?? "user") as ModelMessage["role"], content: tryJson(content) });
      }
    }
  }

  // (3) OpenInference: llm.input_messages.N / output, or input.value / output.value
  if (messages.length === 0 && !system) {
    const iv = tryJson(a["input.value"]);
    if (iv && typeof iv === "object") {
      const arr = (iv as any).messages ?? iv;
      if (Array.isArray(arr)) {
        for (const m of arr) {
          if (m?.role === "system") system = str(m.content) ?? system;
          else messages.push({ role: (m?.role ?? "user") as ModelMessage["role"], content: m?.content });
        }
      } else {
        messages.push({ role: "user", content: iv });
      }
    } else if (str(a["input.value"])) {
      messages.push({ role: "user", content: str(a["input.value"]) });
    }
    const ov = tryJson(a["output.value"]);
    if (ov != null && responseText == null) {
      responseText = typeof ov === "string" ? ov : JSON.stringify(ov);
    }
  }

  if (a["gen_ai.response.reasoning"]) reasoning = str(a["gen_ai.response.reasoning"]) ?? null;

  return { system, messages, responseText, reasoning, toolCalls };
}

function buildLlm(span: RawSpan, a: Record<string, unknown>, seq: number): LlmEvent {
  const { system, messages, responseText, reasoning, toolCalls } = extractMessages(a, span);
  const inTok =
    num(a["gen_ai.usage.input_tokens"]) ?? num(a["gen_ai.usage.prompt_tokens"]) ?? num(a["llm.token_count.prompt"]);
  const outTok =
    num(a["gen_ai.usage.output_tokens"]) ?? num(a["gen_ai.usage.completion_tokens"]) ?? num(a["llm.token_count.completion"]);
  const usage =
    inTok != null || outTok != null
      ? { input_tokens: inTok ?? 0, output_tokens: outTok ?? 0, total_tokens: (inTok ?? 0) + (outTok ?? 0) }
      : null;
  const finish = Array.isArray(a["gen_ai.response.finish_reasons"])
    ? str((a["gen_ai.response.finish_reasons"] as unknown[])[0])
    : str(a["gen_ai.response.finish_reason"]);
  const start = span.startTimeUnixNano;
  const end = span.endTimeUnixNano;
  const latency = start && end ? Math.round(Number(BigInt(end) - BigInt(start)) / 1e6) : null;
  const graph_node = graphNodeFrom(a);
  const routed_from = routedFromAttr(a);

  return {
    schema_version: SCHEMA_VERSION,
    run_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId || null,
    seq,
    ts_start: nanoToIso(start),
    ts_end: end ? nanoToIso(end) : null,
    type: "llm",
    ...(graph_node || routed_from ? { metadata: { ...(graph_node ? { graph_node } : {}), ...(routed_from ? { routed_from } : {}) } } : {}),
    model: {
      provider: str(a["gen_ai.system"]) ?? "otel",
      model_id:
        str(a["gen_ai.request.model"]) ?? str(a["gen_ai.response.model"]) ?? str(a["llm.model_name"]) ?? "unknown",
    },
    request: {
      system,
      messages,
      tools: [],
      params: {
        temperature: num(a["gen_ai.request.temperature"]),
        max_output_tokens: num(a["gen_ai.request.max_tokens"]),
        top_p: num(a["gen_ai.request.top_p"]),
      },
    },
    response: {
      text: responseText,
      reasoning,
      finish_reason: finish ?? (span.status?.code === 2 ? "error" : null),
      tool_calls: toolCalls,
    },
    usage,
    latency_ms: latency,
    error: span.status?.code === 2 ? { name: "SpanError", message: span.status.message ?? "span errored" } : null,
  };
}

function buildTool(span: RawSpan, a: Record<string, unknown>, seq: number): ToolEvent {
  const start = span.startTimeUnixNano;
  const end = span.endTimeUnixNano;
  const latency = start && end ? Math.round(Number(BigInt(end) - BigInt(start)) / 1e6) : null;
  const graph_node = graphNodeFrom(a);
  const routed_from = routedFromAttr(a);
  return {
    schema_version: SCHEMA_VERSION,
    run_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId || null,
    seq,
    ts_start: nanoToIso(start),
    ts_end: end ? nanoToIso(end) : null,
    type: "tool",
    ...(graph_node || routed_from ? { metadata: { ...(graph_node ? { graph_node } : {}), ...(routed_from ? { routed_from } : {}) } } : {}),
    tool_name: str(a["gen_ai.tool.name"]) ?? str(a["tool.name"]) ?? span.name ?? "tool",
    // Fall back to the span id (stable, unique) when the instrumentor omits a tool
    // call id, so the tool is still addressable and distinct (rather than a blank
    // that collides with every other un-id'd tool). OTel links by span hierarchy.
    tool_call_id: str(a["gen_ai.tool.call.id"]) ?? span.spanId,
    input: tryJson(a["traceloop.entity.input"] ?? a["input.value"] ?? a["gen_ai.tool.call.arguments"] ?? a["tool.parameters"]) ?? null,
    output: tryJson(a["traceloop.entity.output"] ?? a["output.value"] ?? a["gen_ai.tool.call.result"]) ?? null,
    latency_ms: latency,
    error: span.status?.code === 2 ? { name: "ToolError", message: span.status.message ?? "tool errored" } : null,
  };
}

/**
 * Standard-tier redaction on every mapped event, matching the first-party SDK
 * collectors' default (@runback/sdk's Collector.push). Unlike those collectors,
 * this runs server-side, after the OTLP payload has already crossed the network
 * to reach us — an OTel-fed integration never gets the "redacted before it
 * leaves your process" guarantee the first-party SDKs give, only "redacted
 * before it's stored or displayed." Same fail-closed rule as the collector:
 * if redaction itself throws, drop the event rather than risk keeping it
 * unredacted.
 */
function redactMapped(events: TraceEvent[]): TraceEvent[] {
  const redactor = createRedactor(true);
  // createRedactor(true) is never null; this branch is unreachable, but on the
  // off chance it isn't, fail closed like everything else here rather than
  // ship the batch unredacted.
  if (!redactor) return [];
  const out: TraceEvent[] = [];
  for (const ev of events) {
    try {
      out.push(redactor.redactEvent(ev));
    } catch {
      /* fail closed: drop rather than ship unredacted content downstream */
    }
  }
  return out;
}

/** Map an OTLP/HTTP trace export body to Runback events, grouped per trace=run. */
export function mapOtlpToEvents(body: any): TraceEvent[] {
  const spans: RawSpan[] = [];
  for (const rs of body?.resourceSpans ?? []) {
    for (const ss of rs?.scopeSpans ?? rs?.instrumentationLibrarySpans ?? []) {
      for (const sp of ss?.spans ?? []) {
        // A span with no traceId/spanId can't be grouped into a run or addressed by
        // the timeline — worse, letting it through used to produce a TraceEvent with
        // run_id/span_id `undefined`. JSON.stringify() drops `undefined` keys, so the
        // eventual DB insert silently omitted run_id (NOT NULL) and storeEvents threw
        // — which, uncaught by this loop, aborted the WHOLE batch, including any
        // other well-formed traces sent in the same export. Drop it here instead, the
        // same way an unclassifiable span already gets dropped-and-counted below.
        if (typeof sp?.traceId === "string" && sp.traceId && typeof sp?.spanId === "string" && sp.spanId) {
          spans.push(sp as RawSpan);
        }
      }
    }
  }
  if (spans.length === 0) return [];

  // group by trace
  const byTrace = new Map<string, RawSpan[]>();
  for (const s of spans) {
    const arr = byTrace.get(s.traceId) ?? [];
    arr.push(s);
    byTrace.set(s.traceId, arr);
  }

  const out: TraceEvent[] = [];
  for (const [traceId, group] of byTrace) {
    group.sort((x, y) => Number(BigInt(x.startTimeUnixNano ?? "0") - BigInt(y.startTimeUnixNano ?? "0")));
    const ids = new Set(group.map((s) => s.spanId));
    const root = group.find((s) => !s.parentSpanId || !ids.has(s.parentSpanId)) ?? group[0];
    const rootAttrs = flattenAttrs(root.attributes);
    // Synthetic run id avoids ever colliding with a content span's id (the root
    // span itself can be an LLM/tool, e.g. OpenInference single-span traces).
    const runStartId = `run:${traceId}`;

    // Build content events. LLM/tool spans become oracle events; other agent steps
    // (chain/retriever/guardrail) become reasoning markers so the timeline keeps its
    // shape; the root non-content span is represented by the run envelope (not
    // double-emitted); anything else is counted, never silently dropped.
    const content: TraceEvent[] = [];
    let droppedSpans = 0;
    for (const s of group) {
      const a = flattenAttrs(s.attributes);
      if (isLlmSpan(a)) content.push(buildLlm(s, a, 0));
      else if (isToolSpan(a)) content.push(buildTool(s, a, 0));
      else if (s.spanId !== root.spanId) {
        const kind = agentStepKind(a);
        if (kind) content.push(buildReasoning(s, a, kind));
        else droppedSpans++;
      }
    }
    // Re-parent orphans (parent was a skipped span or the trace root) under the run.
    const emitted = new Set(content.map((e) => e.span_id));
    for (const e of content) {
      if (!e.parent_span_id || !emitted.has(e.parent_span_id)) {
        (e as { parent_span_id: string | null }).parent_span_id = runStartId;
      }
    }

    const lastSpan = group[group.length - 1];
    const anyError = group.some((s) => s.status?.code === 2);
    const name = str(rootAttrs["gen_ai.agent.name"]) ?? root.name ?? "otel-trace";

    const events: TraceEvent[] = [];
    let seq = 0;
    events.push({
      schema_version: SCHEMA_VERSION,
      run_id: traceId,
      span_id: runStartId,
      parent_span_id: null,
      seq: seq++,
      ts_start: nanoToIso(root.startTimeUnixNano),
      ts_end: null,
      type: "run",
      phase: "start",
      name,
      input: tryJson(rootAttrs["input.value"] ?? rootAttrs["traceloop.entity.input"]) ?? null,
      output: null,
      status: "running",
      error: null,
      metadata: { source: "otel", trace_id: traceId, ...(droppedSpans ? { dropped_spans: droppedSpans } : {}) },
    } satisfies RunEvent);

    for (const e of content) {
      (e as { seq: number }).seq = seq++;
      events.push(e);
    }

    events.push({
      schema_version: SCHEMA_VERSION,
      run_id: traceId,
      span_id: `${runStartId}~end`,
      parent_span_id: runStartId,
      seq: seq++,
      ts_start: nanoToIso(lastSpan.endTimeUnixNano ?? lastSpan.startTimeUnixNano),
      ts_end: nanoToIso(lastSpan.endTimeUnixNano ?? lastSpan.startTimeUnixNano),
      type: "run",
      phase: "end",
      name,
      input: null,
      output: tryJson(rootAttrs["output.value"] ?? rootAttrs["traceloop.entity.output"]) ?? null,
      status: anyError ? "error" : "success",
      error: null,
      metadata: {},
    } satisfies RunEvent);

    out.push(...events);
  }
  return redactMapped(out);
}
