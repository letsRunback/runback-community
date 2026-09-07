/**
 * Deterministic time-travel replay.
 *
 * Reconstructs an agent run, frame by frame, PURELY from its recording — no
 * model calls, no I/O. Frame i is the agent's full state up to and including the
 * i-th step: the conversation as it had unfolded, the running token/cost/latency
 * counters, and the tools called so far. Stepping the frame index backward and
 * forward is time travel.
 *
 * `buildFrames` is a pure function of (run, events): identical input always
 * yields identical output. That determinism is the whole point — an incident
 * reproduces bit-for-bit from the record, and it's verifiable (see the test).
 */
import type {
  TraceEvent,
  LlmEvent,
  ToolEvent,
  ReasoningEvent,
} from "@runback/schema";
import type { RunRow } from "@/lib/runs";

export type Role = "user" | "assistant" | "tool" | "reasoning";
export interface TranscriptEntry {
  role: Role;
  label: string;
  body: string;
  tone?: "error" | "muted";
  /** The frame index this entry first appeared at — click-to-jump target. */
  frameIndex: number;
}
export interface FrameDetail {
  rows: { k: string; v: string }[];
  text?: string | null;
  error?: string | null;
}
export interface Frame {
  index: number;
  seq: number;
  span_id: string;
  kind: "user" | "llm" | "tool" | "reasoning" | "run";
  title: string;
  /** The conversation as it had unfolded up to and including this frame. */
  transcript: TranscriptEntry[];
  cumTokens: number;
  cumCostUsd: number;
  cumLatencyMs: number;
  toolsCalled: string[];
  detail: FrameDetail;
  isFailure: boolean;
  modelId: string | null;
}

// Rough per-1k-token prices (USD) for the running cost estimate. Approximate —
// labelled "est." in the UI — but enough to watch spend accumulate.
const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "gpt-4.1": { in: 0.002, out: 0.008 },
  "claude-sonnet-4-6": { in: 0.003, out: 0.015 },
  "claude-haiku-4-5-20251001": { in: 0.0008, out: 0.004 },
  "llama-3.3-70b-versatile": { in: 0.00059, out: 0.00079 },
  "openai/gpt-oss-120b": { in: 0.00015, out: 0.0006 },
  "openai/gpt-oss-20b": { in: 0.0001, out: 0.0004 },
};
const DEFAULT_PRICE = { in: 0.001, out: 0.003 };

function costOf(modelId: string, inTok: number, outTok: number): number {
  const p = PRICES[modelId] ?? DEFAULT_PRICE;
  return (inTok / 1000) * p.in + (outTok / 1000) * p.out;
}

function truncate(s: string, n = 280): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function clone(t: TranscriptEntry[]): TranscriptEntry[] {
  return t.map((x) => ({ ...x }));
}

export function buildFrames(run: RunRow, events: TraceEvent[]): Frame[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const frames: Frame[] = [];
  const transcript: TranscriptEntry[] = [];
  let cumTokens = 0;
  let cumCost = 0;
  let cumLatency = 0;
  const toolsCalled: string[] = [];

  // Frame 0 — the user's request.
  const userInput = asText(run.input);
  if (userInput) transcript.push({ role: "user", label: "request", body: truncate(userInput, 400), frameIndex: frames.length });
  frames.push({
    index: 0,
    seq: -1,
    span_id: "__start__",
    kind: "user",
    title: "Run started",
    transcript: clone(transcript),
    cumTokens,
    cumCostUsd: cumCost,
    cumLatencyMs: cumLatency,
    toolsCalled: [...toolsCalled],
    detail: { rows: [{ k: "input", v: truncate(userInput, 240) || "—" }] },
    isFailure: false,
    modelId: null,
  });

  for (const e of ordered) {
    if (e.type === "run") continue; // lifecycle envelopes are framed by start/end

    if (e.type === "llm") {
      const llm = e as LlmEvent;
      const inTok = llm.usage?.input_tokens ?? 0;
      const outTok = llm.usage?.output_tokens ?? 0;
      cumTokens += llm.usage?.total_tokens ?? inTok + outTok;
      cumCost += costOf(llm.model.model_id, inTok, outTok);
      cumLatency += llm.latency_ms ?? 0;

      const tc = llm.response.tool_calls;
      let body: string;
      let tone: TranscriptEntry["tone"];
      if (llm.error) {
        body = `error: ${llm.error.message}`;
        tone = "error";
      } else if (tc.length) {
        body = tc.map((t) => `→ ${t.tool_name}(${truncate(asText(t.input), 120)})`).join("\n");
      } else {
        body = truncate(llm.response.text ?? "(no text)", 360);
      }
      if (llm.response.reasoning) {
        transcript.push({ role: "reasoning", label: "thinks", body: truncate(llm.response.reasoning, 240), tone: "muted", frameIndex: frames.length });
      }
      transcript.push({ role: "assistant", label: llm.model.model_id, body, tone, frameIndex: frames.length });

      frames.push({
        index: frames.length,
        seq: llm.seq,
        span_id: llm.span_id,
        kind: "llm",
        title: tc.length ? `Decides: ${tc.map((t) => t.tool_name).join(", ")}` : "Responds",
        transcript: clone(transcript),
        cumTokens,
        cumCostUsd: cumCost,
        cumLatencyMs: cumLatency,
        toolsCalled: [...toolsCalled],
        detail: {
          rows: [
            { k: "model", v: `${llm.model.provider}/${llm.model.model_id}` },
            { k: "finish", v: llm.response.finish_reason ?? "—" },
            { k: "tokens", v: String(llm.usage?.total_tokens ?? "—") },
            { k: "latency", v: llm.latency_ms != null ? `${llm.latency_ms} ms` : "—" },
          ],
          text: llm.response.text,
          error: llm.error?.message ?? null,
        },
        isFailure: !!llm.error,
        modelId: llm.model.model_id,
      });
    } else if (e.type === "tool") {
      const tool = e as ToolEvent;
      cumLatency += tool.latency_ms ?? 0;
      toolsCalled.push(tool.tool_name);
      const body = tool.error ? `error: ${tool.error.message}` : truncate(asText(tool.output), 280);
      transcript.push({ role: "tool", label: tool.tool_name, body, tone: tool.error ? "error" : undefined, frameIndex: frames.length });

      frames.push({
        index: frames.length,
        seq: tool.seq,
        span_id: tool.span_id,
        kind: "tool",
        title: `${tool.tool_name}()${tool.error ? " — failed" : ""}`,
        transcript: clone(transcript),
        cumTokens,
        cumCostUsd: cumCost,
        cumLatencyMs: cumLatency,
        toolsCalled: [...toolsCalled],
        detail: {
          rows: [
            { k: "tool", v: tool.tool_name },
            { k: "input", v: truncate(asText(tool.input), 200) },
            { k: "latency", v: tool.latency_ms != null ? `${tool.latency_ms} ms` : "—" },
          ],
          text: tool.error ? null : truncate(asText(tool.output), 400),
          error: tool.error?.message ?? null,
        },
        isFailure: !!tool.error,
        modelId: null,
      });
    } else if (e.type === "reasoning") {
      const r = e as ReasoningEvent;
      transcript.push({ role: "reasoning", label: r.label ?? "reasoning", body: truncate(r.text, 280), tone: "muted", frameIndex: frames.length });
      frames.push({
        index: frames.length,
        seq: r.seq,
        span_id: r.span_id,
        kind: "reasoning",
        title: r.label ?? "Reasoning",
        transcript: clone(transcript),
        cumTokens,
        cumCostUsd: cumCost,
        cumLatencyMs: cumLatency,
        toolsCalled: [...toolsCalled],
        detail: { rows: [], text: r.text },
        isFailure: false,
        modelId: null,
      });
    }
  }

  // Final frame — run outcome.
  frames.push({
    index: frames.length,
    seq: Number.MAX_SAFE_INTEGER,
    span_id: "__end__",
    kind: "run",
    title: run.status === "error" ? "Run failed" : run.status === "success" ? "Run succeeded" : "Run ended",
    transcript: clone(transcript),
    cumTokens,
    cumCostUsd: cumCost,
    cumLatencyMs: cumLatency,
    toolsCalled: [...toolsCalled],
    detail: {
      rows: [
        { k: "status", v: run.status },
        { k: "steps", v: String(run.step_count) },
        { k: "total tokens", v: String(run.total_tokens) },
      ],
      text: asText(run.output) || null,
      error: asText(run.error) || null,
    },
    isFailure: run.status === "error",
    modelId: null,
  });

  return frames;
}
