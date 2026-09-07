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

/**
 * The models this deployment will actually replay against.
 *
 * REPLAY_MODELS is the hosted-service list, and it is a security control: an
 * arbitrary model string from a request body is forwarded to a provider SDK and
 * billed against a configured key, so the route validates against a fixed set
 * rather than trusting the caller.
 *
 * An air-gapped site runs its own models, which are named for whatever it
 * loaded — "mistral-7b-instruct", "Qwen2.5-72B-Instruct" — none of which can
 * appear in a list compiled here. Extras therefore come from the environment,
 * which is operator-controlled and never request-controlled: the property that
 * makes the allowlist a control is that the caller cannot extend it, and that
 * is preserved.
 */
export function replayModelAllowlist(): string[] {
  const parse = (v: string | undefined) =>
    (v ?? "").split(",").map((m) => m.trim()).filter(Boolean);

  // Two settings, because appending is not what an air-gapped site wants. There
  // the eleven built-ins are unreachable, and listing them is worse than not
  // listing them: every one is a dead option in a dropdown, and the first is
  // the default. RUNBACK_REPLAY_MODELS replaces the list outright; if it is set
  // it wins, and the built-ins do not appear at all.
  const replace = parse(process.env.RUNBACK_REPLAY_MODELS);
  if (replace.length) return replace;

  const extra = parse(process.env.RUNBACK_EXTRA_REPLAY_MODELS);
  return extra.length ? [...REPLAY_MODELS, ...extra] : [...REPLAY_MODELS];
}

/** True when the operator declared this model id in the environment. */
function isOperatorDeclared(modelId: string): boolean {
  // Under RUNBACK_REPLAY_MODELS every entry is operator-declared, including any
  // that happen to share a name with a built-in. Without this a replaced list
  // containing "llama-3.3-70b-versatile" would match the Groq name pattern and
  // be sent to api.groq.com — the exact failure the setting exists to avoid.
  if ((process.env.RUNBACK_REPLAY_MODELS ?? "").trim()) {
    return replayModelAllowlist().includes(modelId);
  }
  return replayModelAllowlist().includes(modelId) && !REPLAY_MODELS.includes(modelId);
}

/** Infer the provider from a model id, falling back to the captured provider. */
function providerForModel(modelId: string, captured: string): ProviderId {
  const m = modelId.toLowerCase();
  // Operator-declared models are checked BEFORE the name patterns, not after.
  // The things sites actually self-host are Qwen, Llama and Mixtral, whose
  // names all match the Groq pattern below — so an air-gapped deployment
  // running its own Qwen would have had every replay sent to api.groq.com,
  // which is precisely the failure this whole path exists to prevent.
  if (isOperatorDeclared(modelId)) {
    for (const p of ["openai", "anthropic", "groq"] as const) {
      if (providerBaseUrl(p)) return p;
    }
  }
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

/**
 * Point a provider at something other than its public API.
 *
 * Without this, replay — and therefore evals, golden suites, the prompt
 * playground, model diff and judge calibration, all of which route through
 * runStep — can only ever reach api.openai.com, api.anthropic.com and
 * api.groq.com. On an air-gapped deployment those hosts do not resolve, so the
 * single most-demoed capability in the product is dead on arrival with no way
 * to configure around it. Such a site runs its own OpenAI-compatible endpoint
 * (vLLM, Ollama, LiteLLM, Azure OpenAI, an internal gateway); this is how they
 * name it.
 *
 * Deliberately RUNBACK_-prefixed rather than the conventional OPENAI_BASE_URL.
 * An unprefixed name set for some other tool in the same environment would
 * silently redirect every model call this deployment makes — which is a
 * security event, not a convenience, and not one anybody would think to look
 * for.
 */
const PROVIDER_BASE_URL_ENV: Record<ProviderId, string> = {
  groq: "RUNBACK_GROQ_BASE_URL",
  openai: "RUNBACK_OPENAI_BASE_URL",
  anthropic: "RUNBACK_ANTHROPIC_BASE_URL",
};

/** Read and validate a provider's base-URL override. Returns undefined when unset. */
export function providerBaseUrl(provider: ProviderId): string | undefined {
  const raw = process.env[PROVIDER_BASE_URL_ENV[provider]]?.trim();
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `${PROVIDER_BASE_URL_ENV[provider]} is not a valid absolute URL: "${raw}". ` +
        "Expected something like http://vllm.internal:8000/v1"
    );
  }
  // "vllm.internal:8000" does not fail URL parsing — it parses as scheme
  // "vllm.internal:", so a missing http:// lands here rather than above.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${PROVIDER_BASE_URL_ENV[provider]} must be http or https, got "${parsed.protocol}" ` +
        `from "${raw}". Include the scheme, e.g. http://vllm.internal:8000/v1`
    );
  }
  return raw;
}

/** Build a language model for replay, or throw a friendly error if the key is missing. */
export function resolveModel(modelId: string, captured: string, keys?: Partial<Record<ProviderId, string>>): any {
  const provider = providerForModel(modelId, captured);
  const baseURL = providerBaseUrl(provider);
  // A per-org BYOK key wins over the deployment env var.
  const key = keys?.[provider] || process.env[PROVIDER_KEY_ENV[provider]];
  if (!key && !baseURL) {
    throw new Error(
      `No ${provider} model key configured — add one in Settings → Model keys (or set ${PROVIDER_KEY_ENV[provider]}) to replay "${modelId}".`
    );
  }
  // Self-hosted inference endpoints frequently take no auth at all. Requiring a
  // key we would only forward to an operator-chosen internal host would block
  // the air-gapped case for no security gain — the operator already decided
  // where these requests go by setting the base URL. The placeholder exists
  // because the provider SDKs require the field to be a string.
  const apiKey = key || "not-required";
  if (provider === "openai") return createOpenAI({ apiKey, baseURL })(modelId);
  if (provider === "anthropic") return createAnthropic({ apiKey, baseURL })(modelId);
  return createGroq({ apiKey, baseURL })(modelId);
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
