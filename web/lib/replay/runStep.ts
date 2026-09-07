/**
 * runStep — the shared replay core.
 *
 * Re-executes a single captured LLM step against a model, optionally with edits
 * or a model override. This is the one place that knows how to turn a captured
 * `LlmEvent` into a fresh model call and extract a comparable output.
 *
 * Two consumers:
 *   1. POST /api/replay — interactive replay in the debugger (one step, ad hoc).
 *   2. The eval runner   — replays every item in a dataset and scores the output.
 *
 * It returns BOTH a rich `response` (for the side-by-side replay UI) and a flat
 * `ReplayedOutput` (the exact shape the scorers consume). Keeping the model
 * plumbing here means the runner and the route never drift.
 */
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LlmEvent, ModelMessage, ToolDefinition } from "@runback/schema";
import type { ReplayedOutput } from "@/lib/eval/scorers";
import { REPLAY_MODELS } from "./models";

export { REPLAY_MODELS };

/* eslint-disable @typescript-eslint/no-explicit-any */

type ProviderId = "groq" | "openai" | "anthropic";

/** Infer the provider from a model id, falling back to the captured provider. */
function providerForModel(modelId: string, captured: string): ProviderId {
  const m = modelId.toLowerCase();
  if (/^claude/.test(m)) return "anthropic";
  if (/^(gpt-(3|4)|o1|o3|o4|chatgpt|text-)/.test(m)) return "openai";
  if (/gpt-oss|llama|qwen|kimi|mixtral|gemma|deepseek/.test(m)) return "groq";
  const c = captured.toLowerCase();
  if (c.startsWith("anthropic")) return "anthropic";
  if (c.startsWith("openai")) return "openai";
  return "groq";
}

const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** Build a language model for replay, or throw a friendly error if the key is missing. */
export function resolveModel(modelId: string, captured: string, keys?: Partial<Record<ProviderId, string>>): any {
  const provider = providerForModel(modelId, captured);
  // A per-org BYOK key wins over the deployment env var.
  const key = keys?.[provider] || process.env[PROVIDER_KEY_ENV[provider]];
  if (!key) {
    throw new Error(
      `No ${provider} model key configured — add one in Settings → Model keys (or set ${PROVIDER_KEY_ENV[provider]}) to replay "${modelId}".`
    );
  }
  if (provider === "openai") return createOpenAI({ apiKey: key })(modelId);
  if (provider === "anthropic") return createAnthropic({ apiKey: key })(modelId);
  return createGroq({ apiKey: key })(modelId);
}

/** Provider messages require array content for non-system roles; wrap bare strings. */
function normalizeMessages(system: string | null, messages: ModelMessage[]) {
  const prompt: any[] = [];
  if (system) prompt.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "system") {
      prompt.push({ role: "system", content: typeof m.content === "string" ? m.content : "" });
    } else if (typeof m.content === "string") {
      prompt.push({ role: m.role, content: [{ type: "text", text: m.content }] });
    } else {
      prompt.push({ role: m.role, content: m.content });
    }
  }
  return prompt;
}

function mapTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    inputSchema: (t.parameters as any) ?? { type: "object", properties: {} },
  }));
}

// V3 returns token counts as { total, ... } and finishReason as { unified, raw }.
function tokenCount(v: any): number | undefined {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof v.total === "number") return v.total;
  return undefined;
}
function finishReasonStr(v: any): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof v.unified === "string") return v.unified;
  return null;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export interface ExtractedResponse {
  text: string | null;
  reasoning: string | null;
  finish_reason: string | null;
  tool_calls: { tool_call_id: string; tool_name: string; input: unknown }[];
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
}

function extractResponse(result: any): ExtractedResponse {
  const content: any[] = Array.isArray(result?.content) ? result.content : [];
  const text =
    content.filter((p) => p?.type === "text").map((p) => p.text).join("") || null;
  const reasoning =
    content.filter((p) => p?.type === "reasoning").map((p) => p.text).join("") || null;
  const tool_calls = content
    .filter((p) => p?.type === "tool-call")
    .map((p) => ({
      tool_call_id: p.toolCallId,
      tool_name: p.toolName,
      input: typeof p.input === "string" ? safeParse(p.input) : p.input,
    }));
  const u = result?.usage ?? {};
  const input = tokenCount(u.inputTokens);
  const output = tokenCount(u.outputTokens);
  const total = tokenCount(u.totalTokens);
  const usage =
    input != null || output != null || total != null
      ? {
          input_tokens: input ?? 0,
          output_tokens: output ?? 0,
          total_tokens: total ?? (input ?? 0) + (output ?? 0),
        }
      : null;
  return { text, reasoning, finish_reason: finishReasonStr(result?.finishReason), tool_calls, usage };
}

/** Flatten an extracted response into the shape the scorers assert against. */
function toScorerOutput(
  resp: ExtractedResponse,
  latency_ms: number,
  error: { message: string } | null
): ReplayedOutput {
  return {
    text: resp.text,
    finish_reason: resp.finish_reason,
    tool_calls: resp.tool_calls.map((t) => ({ tool_name: t.tool_name, input: t.input })),
    latency_ms,
    total_tokens: resp.usage?.total_tokens ?? null,
    error,
  };
}

export interface RunStepInput {
  /** The captured request (system / messages / tools / params) to replay. */
  request: LlmEvent["request"];
  /** The captured model — { provider, model_id }. */
  model: LlmEvent["model"];
  /** Allowlisted model override; falls back to the captured model. */
  model_id?: string;
  /** Optional edits applied over the captured request. */
  edits?: { system?: string | null; messages?: ModelMessage[] };
  /** Demo/zero-cost: return a simulated result instead of calling a provider. */
  demo?: boolean;
  /** Per-org BYOK provider keys (win over env). Resolved by the caller from the run's org. */
  keys?: Partial<Record<ProviderId, string>>;
}

export interface RunStepResult {
  ok: boolean;
  /** Rich response for the side-by-side replay UI. Empty on error. */
  response: ExtractedResponse;
  /** Flat output the scorers consume. */
  output: ReplayedOutput;
  latency_ms: number;
  model: { provider: string; model_id: string };
  /** True if the prompt or model differed from what was captured. */
  edited: boolean;
  /** Friendly message when the step could not be (re-)executed. */
  error: string | null;
}

const EMPTY_RESPONSE: ExtractedResponse = {
  text: null,
  reasoning: null,
  finish_reason: null,
  tool_calls: [],
  usage: null,
};

/**
 * Re-execute one captured LLM step. Never throws — failures (missing key, model
 * error) come back as `{ ok: false, error }` so callers can render or score them.
 */
export async function runStep(input: RunStepInput): Promise<RunStepResult> {
  // Demo accounts / hosted demo: never touch a provider — simulate the step.
  if (input.demo) {
    const { simulateRunStep } = await import("./simulate");
    return simulateRunStep(input);
  }

  const captured = input.request;

  // Apply edits over the captured request.
  const system =
    input.edits?.system !== undefined ? input.edits.system : captured.system;
  const messages = input.edits?.messages ?? captured.messages;

  // Use the captured model by default; allow an allowlisted override.
  const modelId =
    input.model_id && REPLAY_MODELS.includes(input.model_id)
      ? input.model_id
      : input.model.model_id;
  const modelChanged = modelId !== input.model.model_id;
  const edited =
    modelChanged ||
    input.edits?.system !== undefined ||
    input.edits?.messages !== undefined;
  // Report the provider that ACTUALLY served the replay, not the one captured.
  // Overriding gpt-4o with a Groq model used to come back labelled
  // provider:"openai", which is wrong in the UI and wrong in any downstream
  // cost/attribution derived from it. Same resolution resolveModel() uses.
  const model = {
    provider: modelChanged ? providerForModel(modelId, input.model.provider) : input.model.provider,
    model_id: modelId,
  };

  let resolved: any;
  try {
    resolved = resolveModel(modelId, input.model.provider, input.keys);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      response: EMPTY_RESPONSE,
      output: toScorerOutput(EMPTY_RESPONSE, 0, { message: msg }),
      latency_ms: 0,
      model,
      edited,
      error: msg,
    };
  }

  const prompt = normalizeMessages(system, messages);
  const tools = mapTools(captured.tools);
  const p = captured.params;

  // Cost guardrail: never let a single replay request a runaway generation.
  const MAX_REPLAY_OUTPUT = 4096;

  const t0 = Date.now();
  try {
    const result = await resolved.doGenerate({
      prompt,
      tools: tools.length ? tools : undefined,
      temperature: p.temperature,
      maxOutputTokens: Math.min(p.max_output_tokens ?? MAX_REPLAY_OUTPUT, MAX_REPLAY_OUTPUT),
      topP: p.top_p,
    });
    const latency_ms = Date.now() - t0;
    const response = extractResponse(result);
    return {
      ok: true,
      response,
      output: toScorerOutput(response, latency_ms, null),
      latency_ms,
      model,
      edited,
      error: null,
    };
  } catch (err) {
    const latency_ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      response: EMPTY_RESPONSE,
      output: toScorerOutput(EMPTY_RESPONSE, latency_ms, { message: msg }),
      latency_ms,
      model,
      edited,
      error: msg,
    };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
