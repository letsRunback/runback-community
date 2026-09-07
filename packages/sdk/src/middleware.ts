import type { LanguageModelMiddleware } from "ai";
import type {
  ModelMessage,
  ToolDefinition,
  TokenUsage,
} from "@runback/schema";
import type { Collector } from "./collector.js";
import { runInstrumented } from "./instrumentedMarker.js";

function tryParse(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

// The provider call-options / result types are deeply generic; we read a small,
// stable subset, so narrow locally rather than importing the full provider types.
/* eslint-disable @typescript-eslint/no-explicit-any */

function extractRequest(params: any) {
  const prompt: any[] = Array.isArray(params?.prompt) ? params.prompt : [];
  const systemParts = prompt
    .filter((m) => m?.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean);
  const messages: ModelMessage[] = prompt
    .filter((m) => m?.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const tools: ToolDefinition[] = Array.isArray(params?.tools)
    ? params.tools.map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ?? t.parameters ?? null,
      }))
    : [];
  return {
    system: systemParts.length ? systemParts.join("\n\n") : null,
    messages,
    tools,
    params: {
      temperature: params?.temperature,
      max_output_tokens: params?.maxOutputTokens,
      top_p: params?.topP,
    },
  };
}

// AI SDK v3 (LanguageModelV3) returns usage token counts as objects
// ({ total, noCache, ... }) and finishReason as { unified, raw }. v2 used
// primitives. Read either shape defensively.
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

function extractResponse(result: any) {
  const content: any[] = Array.isArray(result?.content) ? result.content : [];
  const text =
    content
      .filter((p) => p?.type === "text")
      .map((p) => p.text)
      .join("") || null;
  const reasoning =
    content
      .filter((p) => p?.type === "reasoning")
      .map((p) => p.text)
      .join("") || null;
  const tool_calls = content
    .filter((p) => p?.type === "tool-call")
    .map((p) => ({
      tool_call_id: p.toolCallId,
      tool_name: p.toolName,
      input: tryParse(p.input),
    }));
  const u = result?.usage ?? {};
  const input = tokenCount(u.inputTokens);
  const output = tokenCount(u.outputTokens);
  const total = tokenCount(u.totalTokens);
  const usage: TokenUsage | null =
    input != null || output != null || total != null
      ? {
          input_tokens: input ?? 0,
          output_tokens: output ?? 0,
          total_tokens: total ?? (input ?? 0) + (output ?? 0),
        }
      : null;
  return {
    text,
    reasoning,
    finish_reason: finishReasonStr(result?.finishReason),
    tool_calls,
    usage,
  };
}

function usageFromV3(u: any): TokenUsage | null {
  const input = tokenCount(u?.inputTokens);
  const output = tokenCount(u?.outputTokens);
  const total = tokenCount(u?.totalTokens);
  return input != null || output != null || total != null
    ? {
        input_tokens: input ?? 0,
        output_tokens: output ?? 0,
        total_tokens: total ?? (input ?? 0) + (output ?? 0),
      }
    : null;
}

/**
 * Middleware that captures the *exact context window* (request side) at the
 * doGenerate boundary plus the response/usage/latency. This boundary is the only
 * place the fully-assembled messages array is visible — the reason Runback's
 * inspector can show "what the model saw at step N".
 */
export function debuggerMiddleware(collector: Collector): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    // streamText() goes through wrapStream, NOT wrapGenerate — the AI SDK
    // calls whichever one matches how the caller invoked the model, and
    // silently falls back to the unwrapped model.doStream() if wrapStream is
    // absent. Without this, every streamText() call produced zero captured
    // events with no error and no warning.
    wrapStream: async ({ doStream, params, model }) => {
      collector.envDepth++;
      const tsStart = new Date().toISOString();
      const t0 = Date.now();
      const request = extractRequest(params);
      const modelInfo = {
        provider: (model as any)?.provider ?? "unknown",
        model_id: (model as any)?.modelId ?? "unknown",
      };

      let result;
      try {
        result = await runInstrumented(() => doStream());
      } catch (err) {
        collector.envDepth--;
        collector.recordLlm({
          ts_start: tsStart,
          ts_end: new Date().toISOString(),
          model: modelInfo,
          request,
          response: { text: null, reasoning: null, finish_reason: "error", tool_calls: [] },
          usage: null,
          latency_ms: Date.now() - t0,
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : { name: "Error", message: String(err) },
        } as any);
        throw err;
      }

      // Reassemble the full response from stream deltas — the same shape
      // recordLlm gets from wrapGenerate — so replay/model-diff/inspector see
      // one consistent llm-event shape regardless of which call style the
      // integrator used.
      let text = "";
      let reasoning = "";
      const toolCalls: { tool_call_id: string; tool_name: string; input: unknown }[] = [];
      let finishReason: string | null = null;
      let usage: TokenUsage | null = null;
      let streamError: unknown = null;
      let recorded = false;

      const record = () => {
        if (recorded) return;
        recorded = true;
        collector.envDepth--;
        if (streamError) {
          collector.recordLlm({
            ts_start: tsStart,
            ts_end: new Date().toISOString(),
            model: modelInfo,
            request,
            response: { text: text || null, reasoning: reasoning || null, finish_reason: "error", tool_calls: toolCalls },
            usage,
            latency_ms: Date.now() - t0,
            error:
              streamError instanceof Error
                ? { name: streamError.name, message: streamError.message, stack: streamError.stack }
                : { name: "Error", message: String(streamError) },
          } as any);
        } else {
          collector.recordLlm({
            ts_start: tsStart,
            ts_end: new Date().toISOString(),
            model: modelInfo,
            request,
            response: { text: text || null, reasoning: reasoning || null, finish_reason: finishReason, tool_calls: toolCalls },
            usage,
            latency_ms: Date.now() - t0,
            error: null,
          } as any);
        }
      };

      const transform = new TransformStream<any, any>({
        transform(chunk, controller) {
          try {
            switch (chunk?.type) {
              case "text-delta":
                text += chunk.delta ?? "";
                break;
              case "reasoning-delta":
                reasoning += chunk.delta ?? "";
                break;
              case "tool-call":
                toolCalls.push({
                  tool_call_id: chunk.toolCallId,
                  tool_name: chunk.toolName,
                  input: tryParse(chunk.input),
                });
                break;
              case "finish":
                finishReason = finishReasonStr(chunk.finishReason);
                usage = usageFromV3(chunk.usage);
                break;
              case "error":
                streamError = chunk.error;
                break;
              default:
                break;
            }
          } catch {
            // A malformed chunk must never break the pass-through to the
            // real consumer — worst case this llm event is recorded with
            // partial data, not silently dropped.
          }
          controller.enqueue(chunk);
        },
        flush() {
          record();
        },
      });

      return { ...result, stream: result.stream.pipeThrough(transform) };
    },
    wrapGenerate: async ({ doGenerate, params, model }) => {
      // The model call (and the provider's internal fetch/clock/random) is an
      // oracle — its response is recorded as the llm event, so keep env capture
      // opaque across it.
      collector.envDepth++;
      try {
      const tsStart = new Date().toISOString();
      const t0 = Date.now();
      const request = extractRequest(params);
      const modelInfo = {
        provider: (model as any)?.provider ?? "unknown",
        model_id: (model as any)?.modelId ?? "unknown",
      };
      try {
        // Marks this specific provider call as instrumented so bypassGuard.ts
        // can tell it apart from a fetch to the same provider made completely
        // outside withDebugger — the difference between "captured" and
        // "invisible to Runback."
        const result = await runInstrumented(() => doGenerate());
        const r = extractResponse(result);
        collector.recordLlm({
          ts_start: tsStart,
          ts_end: new Date().toISOString(),
          model: modelInfo,
          request,
          response: {
            text: r.text,
            reasoning: r.reasoning,
            finish_reason: r.finish_reason,
            tool_calls: r.tool_calls,
          },
          usage: r.usage,
          latency_ms: Date.now() - t0,
          error: null,
        } as any);
        return result;
      } catch (err) {
        collector.recordLlm({
          ts_start: tsStart,
          ts_end: new Date().toISOString(),
          model: modelInfo,
          request,
          response: {
            text: null,
            reasoning: null,
            finish_reason: "error",
            tool_calls: [],
          },
          usage: null,
          latency_ms: Date.now() - t0,
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : { name: "Error", message: String(err) },
        } as any);
        throw err;
      }
      } finally {
        collector.envDepth--;
      }
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
