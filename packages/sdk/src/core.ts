/**
 * The part of the SDK that does NOT need the Vercel AI SDK.
 *
 * `@runback/sdk` declares `ai` as a peer, and the root entry imports
 * wrapLanguageModel from it at module load — so importing anything, including
 * the framework-agnostic startRun(), required installing `ai` first. For a team
 * whose agent is not built on the AI SDK that is a large unrelated dependency
 * standing between them and their first recorded run.
 *
 * Import from "@runback/sdk/core" to record runs from any TypeScript agent loop
 * with no peer dependency at all:
 *
 *   import { startRun } from "@runback/sdk/core";
 *
 * The root entry re-exports everything here, so "@runback/sdk" keeps working
 * unchanged for anyone already on the AI SDK.
 */
import { Collector, type CollectorOptions } from "./collector.js";

export { Collector } from "./collector.js";
export type { CollectorOptions } from "./collector.js";
export type { EnvKind, EnvSink } from "./envHook.js";
export type { PolicyRule, Predicate, EnforcementDecision } from "@runback/policy";
// "@runback/sdk/core" is the same surface as index.ts without the `ai` peer, so
// it carries the same Enterprise-licensed exports and goes through the same
// swappable seam. It had its own inline copy of that block, which meant the
// Community build compiled index.ts fine and left this entry point broken.
export * from "./enterpriseSurface.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Framework-agnostic manual recorder. Use this when you're NOT on the Vercel AI
 * SDK — record steps by hand from any TypeScript/JavaScript agent loop:
 *
 *   const run = startRun({ runName: "my-agent", input: task, redact: "standard" });
 *   run.llm({ model: { provider: "openai", model_id: "gpt-4o" }, request, response, usage, latencyMs });
 *   run.tool({ toolName: "search", toolCallId: "1", input, output, latencyMs });
 *   run.reasoning("decided to search");
 *   await run.finish({ output, status: "success" });
 */
export function startRun(opts: CollectorOptions) {
  const c = new Collector(opts);
  return {
    runId: c.runId,
    llm(ev: {
      model: { provider: string; model_id: string };
      request: {
        system?: string | null;
        messages: { role: string; content: unknown }[];
        tools?: { name: string; description?: string; parameters: unknown }[];
        params?: { temperature?: number; max_output_tokens?: number; top_p?: number };
      };
      response: {
        text?: string | null;
        reasoning?: string | null;
        finish_reason?: string | null;
        tool_calls?: { tool_call_id: string; tool_name: string; input: unknown }[];
      };
      usage?: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
      latencyMs?: number | null;
      error?: { name: string; message: string; stack?: string } | null;
    }): string {
      const now = new Date().toISOString();
      return c.recordLlm({
        ts_start: now,
        ts_end: now,
        model: ev.model,
        request: {
          system: ev.request.system ?? null,
          messages: ev.request.messages as any,
          tools: (ev.request.tools ?? []) as any,
          params: ev.request.params ?? {},
        },
        response: {
          text: ev.response.text ?? null,
          reasoning: ev.response.reasoning ?? null,
          finish_reason: ev.response.finish_reason ?? null,
          tool_calls: ev.response.tool_calls ?? [],
        },
        usage: ev.usage ?? null,
        latency_ms: ev.latencyMs ?? null,
        error: ev.error ?? null,
      } as any);
    },
    tool(args: {
      toolName: string;
      toolCallId?: string;
      input: unknown;
      output?: unknown;
      latencyMs?: number | null;
      error?: unknown;
      actor?: { type: "user" | "api_key" | "system"; id: string; label?: string };
    }) {
      c.recordTool({
        tool_name: args.toolName,
        tool_call_id: args.toolCallId ?? "",
        input: args.input,
        output: args.output ?? null,
        latency_ms: args.latencyMs ?? null,
        error: args.error ?? null,
        ts_start: new Date().toISOString(),
        actor: args.actor,
      });
    },
    reasoning(text: string, label?: string) {
      c.recordReasoning(text, label ?? null);
    },
    finish(result: { output?: unknown; status?: "success" | "error"; error?: unknown }) {
      return c.finish(result);
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
