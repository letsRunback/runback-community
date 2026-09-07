/**
 * Simulated replay — the zero-cost engine behind the hosted demo.
 *
 * On runback.dev there are no provider keys (by design — see lib/demoMode.ts), so
 * a real replay can't run. But the whole point a customer needs to *see* is the
 * difference: pick another model, watch the answer, latency, tokens, and tool
 * calls change side by side. This module synthesises that difference without ever
 * calling a provider.
 *
 * It is fully deterministic: the same (model, step, edit) always yields the same
 * result, so a demo reproduces exactly the same way every time you click — no
 * surprises in front of a buyer. Nothing here uses Math.random or the clock for
 * content; the only varying signal is a hash of the inputs.
 *
 * What it does NOT do: invent prose a model "would" say. That risks garbage on
 * screen. Instead it keeps the captured answer as the anchor and varies the
 * things Runback actually sells on — latency, token cost, finish reason, and
 * tool-call shape — plus restrained, model-appropriate phrasing. The captured
 * model replayed as-is reproduces byte-for-byte (the determinism story); other
 * models diverge in believable, tier-appropriate ways.
 */
import type { LlmEvent, ModelMessage } from "@runback/schema";
import type { ExtractedResponse, RunStepInput, RunStepResult } from "./runStep";
import { REPLAY_MODELS } from "./models";

/* ---------- deterministic hashing (FNV-1a, no clock, no randomness) ---------- */

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A stable 0..1 fraction from a seed string — our only source of "variation". */
function frac(seed: string): number {
  return (hash(seed) % 10000) / 10000;
}

/* ---------- model profiles: how each tier behaves relative to the others ---------- */

type Tier = "frontier" | "balanced" | "fast" | "flaky";

interface Profile {
  tier: Tier;
  /** Baseline latency in ms before per-step jitter. */
  latency: number;
  /** Output-token multiplier vs. the captured answer. */
  tokens: number;
}

const PROFILES: Record<Tier, Profile> = {
  frontier: { tier: "frontier", latency: 880, tokens: 1.18 },
  balanced: { tier: "balanced", latency: 560, tokens: 1.0 },
  fast: { tier: "fast", latency: 300, tokens: 0.72 },
  flaky: { tier: "flaky", latency: 640, tokens: 0.85 },
};

/** Map a model id to a behavioural tier. Mirrors the real-world reputation of each. */
function tierFor(modelId: string): Tier {
  const m = modelId.toLowerCase();
  // llama on Groq intermittently malforms tool calls — the codebase already flags
  // this elsewhere, so the demo can honestly show it as a tool-call regression.
  if (/llama-3\.3-70b|llama-3\.1-8b/.test(m)) return "flaky";
  if (/gpt-4\.1|gpt-4o(?!-mini)|claude-sonnet|gpt-oss-120b/.test(m)) return "frontier";
  if (/mini|haiku|gpt-oss-20b|8b-instant|qwen3-32b/.test(m)) return "fast";
  return "balanced";
}

/* ---------- text variation: restrained, tier-appropriate, never garbage ---------- */

const FRONTIER_CAVEAT =
  " I've also flagged one edge case worth confirming before you act on this.";

function varyText(base: string | null, tier: Tier, seed: string): string | null {
  if (!base) return base;
  const sentences = base.split(/(?<=[.!?])\s+/).filter(Boolean);

  if (tier === "fast") {
    // Smaller/faster models tend to be terser — keep the lead, drop the tail.
    if (sentences.length <= 1) return base;
    const keep = Math.max(1, Math.round(sentences.length * 0.6));
    return sentences.slice(0, keep).join(" ");
  }
  if (tier === "frontier") {
    // More capable models tend to add a precise caveat the captured run lacked.
    return base.endsWith(FRONTIER_CAVEAT) ? base : base + FRONTIER_CAVEAT;
  }
  if (tier === "flaky") {
    // When there are no tools to malform, a flaky model just rephrases the open.
    return frac(seed) > 0.5 && sentences.length > 1
      ? sentences.slice(1).join(" ")
      : base;
  }
  return base; // balanced ≈ the captured answer
}

/* ---------- tool-call variation ---------- */

type ToolCall = LlmEvent["response"]["tool_calls"][number];

function varyToolCalls(
  calls: ToolCall[],
  tier: Tier,
  seed: string
): { calls: ToolCall[]; malformed: boolean } {
  if (calls.length === 0) return { calls, malformed: false };
  if (tier === "flaky" && frac(seed + ":tool") > 0.45) {
    // The headline regression demo: the flaky model drops a tool call, so the
    // step finishes as plain text instead of acting. Exactly what replay catches.
    return { calls: calls.slice(0, calls.length - 1), malformed: true };
  }
  return { calls, malformed: false };
}

/* ---------- token + latency synthesis ---------- */

function estimateTokens(event: LlmEvent): number {
  if (event.usage?.total_tokens) return event.usage.total_tokens;
  const resp = event.response;
  const chars = (resp.text ?? "").length + JSON.stringify(resp.tool_calls).length;
  return Math.max(24, Math.round(chars / 4));
}

/* ---------- public API ---------- */

export interface SimulateInput {
  original: LlmEvent;
  /** Allowlisted target model; falls back to the captured model. */
  modelId?: string;
  /** Whether the user edited the prompt (changes the "reproduces exactly" path). */
  promptEdited?: boolean;
  editedMessages?: ModelMessage[];
}

export interface SimulatedResult {
  response: ExtractedResponse;
  latency_ms: number;
  model: { provider: string; model_id: string };
  edited: boolean;
  demo: true;
  /** Set when the simulated model malformed/dropped a tool call. */
  regression?: boolean;
}

/**
 * Produce a believable, fully-simulated replay of one captured step. Never calls
 * a provider; never throws. Same inputs → identical output, every time.
 */
export function simulateStep(input: SimulateInput): SimulatedResult {
  const captured = input.original;
  const capturedModel = captured.model.model_id;
  const modelId =
    input.modelId && REPLAY_MODELS.includes(input.modelId)
      ? input.modelId
      : capturedModel;

  const modelChanged = modelId !== capturedModel;
  const edited = modelChanged || !!input.promptEdited;
  const seed = `${captured.run_id}:${captured.span_id}:${modelId}:${input.promptEdited ? "e" : ""}`;

  // The captured model, replayed as-is, reproduces byte-for-byte. That IS the
  // demo for determinism — don't perturb it.
  if (!edited) {
    return {
      response: {
        text: captured.response.text,
        reasoning: captured.response.reasoning,
        finish_reason: captured.response.finish_reason,
        tool_calls: captured.response.tool_calls,
        usage: captured.usage,
      },
      latency_ms: captured.latency_ms ?? 0,
      model: { provider: captured.model.provider, model_id: modelId },
      edited: false,
      demo: true,
    };
  }

  const tier = modelChanged ? tierFor(modelId) : "balanced";
  const profile = PROFILES[tier];

  const text = varyText(captured.response.text, tier, seed);
  const { calls, malformed } = varyToolCalls(captured.response.tool_calls, tier, seed);

  const baseTokens = estimateTokens(captured);
  const jitter = 0.9 + frac(seed + ":tok") * 0.2; // ±10%, deterministic
  const total = Math.max(16, Math.round(baseTokens * profile.tokens * jitter));
  const input_tokens = Math.round(total * 0.68);
  const output_tokens = total - input_tokens;

  const latency = Math.round(
    profile.latency * (0.85 + frac(seed + ":lat") * 0.3)
  );

  const finish_reason = malformed
    ? "stop"
    : calls.length
    ? "tool-call"
    : "stop";

  return {
    response: {
      text: malformed
        ? (text ?? "") + " (Note: I couldn't complete the tool call.)"
        : text,
      reasoning: captured.response.reasoning,
      finish_reason,
      tool_calls: calls,
      usage: { input_tokens, output_tokens, total_tokens: total },
    },
    latency_ms: latency,
    model: { provider: captured.model.provider, model_id: modelId },
    edited: true,
    demo: true,
    regression: malformed || finish_reason !== captured.response.finish_reason,
  };
}

/* ---------- simulateRunStep: the demo path for runStep itself ---------- */

/** The most recent user-authored text in a request — the anchor for a synthesized answer. */
function lastUserText(request: LlmEvent["request"]): string | null {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const m = request.messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return null;
}

/**
 * Simulate a single runStep WITHOUT a captured response to anchor on — used by
 * whole-run counterfactual replay, where the engine drives step-by-step calls.
 * Returns the exact `RunStepResult` shape runStep would, so callers (and the
 * replay engine) can't tell it apart from a real call. Zero cost, deterministic.
 */
export function simulateRunStep(input: RunStepInput): RunStepResult {
  const capturedModel = input.model.model_id;
  const modelId =
    input.model_id && REPLAY_MODELS.includes(input.model_id)
      ? input.model_id
      : capturedModel;
  const modelChanged = modelId !== capturedModel;

  const prompt = lastUserText(input.request);
  const seed = `${modelId}:${(prompt ?? "step").slice(0, 80)}`;
  const tier = modelChanged ? tierFor(modelId) : "balanced";
  const profile = PROFILES[tier];

  const base = `Simulated answer for "${(prompt ?? "this step").slice(0, 60)}".`;
  const text = modelChanged ? varyText(base, tier, seed) : base;

  const baseTokens = Math.max(24, Math.round((text ?? "").length / 4) + 40);
  const jitter = 0.9 + frac(seed + ":tok") * 0.2;
  const total = Math.max(16, Math.round(baseTokens * profile.tokens * jitter));
  const input_tokens = Math.round(total * 0.68);
  const output_tokens = total - input_tokens;
  const latency_ms = Math.round(profile.latency * (0.85 + frac(seed + ":lat") * 0.3));

  const response: ExtractedResponse = {
    text,
    reasoning: null,
    finish_reason: "stop",
    tool_calls: [],
    usage: { input_tokens, output_tokens, total_tokens: total },
  };

  return {
    ok: true,
    response,
    output: {
      text,
      finish_reason: "stop",
      tool_calls: [],
      latency_ms,
      total_tokens: total,
      error: null,
    },
    latency_ms,
    model: { provider: input.model.provider, model_id: modelId },
    edited: modelChanged,
    error: null,
  };
}
