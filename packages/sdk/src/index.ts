import { wrapLanguageModel, type LanguageModel } from "ai";
import { Collector, type CollectorOptions, type FinishResult } from "./collector.js";
import { debuggerMiddleware } from "./middleware.js";
import { withEnvCaptureIfAvailable } from "./envHook.js";
import { installBypassGuard } from "./bypassGuard.js";

export { Collector } from "./collector.js";
export type { CollectorOptions, FlushResult, FinishResult } from "./collector.js";
export type { EnvKind, EnvSink } from "./envHook.js";
export { installBypassGuard } from "./bypassGuard.js";
export type { BypassGuardOptions, BypassEvent } from "./bypassGuard.js";
export type { PolicyRule, Predicate, EnforcementDecision } from "@runback/policy";
// The Enterprise-licensed surface, isolated so a Community build can drop it
// by swapping one file. See enterpriseSurface.ts.
export * from "./enterpriseSurface.js";
// Re-exported so "@runback/sdk" is unchanged; "@runback/sdk/core" is the same
// surface without the `ai` peer.
export { startRun } from "./core.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Wrap each tool's `execute` so the tool span (input, output, latency, error) is
 * recorded reliably — even when the tool throws (which otherwise rejects the
 * whole generateText call before any step callback fires).
 */
function instrumentTools<T extends Record<string, any>>(
  tools: T,
  collector: Collector
): T {
  const out: Record<string, any> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool || typeof tool.execute !== "function") {
      out[name] = tool;
      continue;
    }
    const original = tool.execute.bind(tool);
    out[name] = {
      ...tool,
      execute: async (input: unknown, options: any) => {
        // Runtime enforcement pre-hook: evaluate the policy BEFORE the tool runs.
        // On a block, the tool never executes; we return a clear result (a soft
        // block) so the agent can re-plan, and the block is recorded as proof.
        const decision = collector.enforceToolCall(name, input);
        if (!decision.allowed) {
          return { runback_blocked: true, rule: decision.rule, reason: decision.detail };
        }
        // The tool is an oracle — its internal clock/random/fetch reads are
        // captured by its recorded output, so env capture stays opaque inside it.
        collector.envDepth++;
        const tsStart = new Date().toISOString();
        const t0 = Date.now();
        const toolCallId = options?.toolCallId ?? "";
        try {
          const output = await original(input, options);
          collector.recordTool({
            tool_name: name,
            tool_call_id: toolCallId,
            input,
            output,
            latency_ms: Date.now() - t0,
            error: null,
            ts_start: tsStart,
            policyEvaluated: decision.evaluated,
          });
          return output;
        } catch (err) {
          collector.recordTool({
            tool_name: name,
            tool_call_id: toolCallId,
            input,
            output: null,
            latency_ms: Date.now() - t0,
            error: err,
            ts_start: tsStart,
            policyEvaluated: decision.evaluated,
          });
          throw err;
        } finally {
          collector.envDepth--;
        }
      },
    };
  }
  return out as T;
}

export interface Debugger {
  /** The instrumented model — pass this to generateText/streamText. */
  model: LanguageModel;
  /** Instrument your tools map so tool calls (and errors) are captured. */
  tools<T extends Record<string, any>>(tools: T): T;
  /** The underlying collector (for advanced use). */
  collector: Collector;
  /**
   * Run your agent inside a guaranteed environment-capture scope. The most robust
   * way to enable byte-exact capture for complex/async agents:
   *   const res = await dbg.capture(() => generateText({ model: dbg.model, ... }));
   */
  capture<T>(fn: () => T): T;
  /**
   * Record the run-end envelope and flush all buffered events. Call once, at
   * the end. Resolves with whether the run actually reached the collector —
   * check `.ok` when the record matters.
   */
  finish(result: {
    output?: unknown;
    status?: "success" | "error";
    error?: unknown;
  }): Promise<FinishResult>;
}

/**
 * Instrument an agent for Runback in ~3 lines:
 *
 *   const dbg = withDebugger(groq("llama-3.3-70b-versatile"), { runName: "demo", input: task });
 *   const res = await generateText({ model: dbg.model, tools: dbg.tools(myTools), stopWhen: stepCountIs(8) });
 *   await dbg.finish({ output: res.text, status: "success" });
 */
export function withDebugger(
  model: LanguageModel,
  opts: CollectorOptions
): Debugger {
  if (opts.enforceCapture) {
    installBypassGuard(
      opts.enforceCapture === true
        ? { ingestUrl: opts.ingestUrl, apiKey: opts.apiKey }
        : { ingestUrl: opts.ingestUrl, apiKey: opts.apiKey, ...opts.enforceCapture }
    );
  }
  const collector = new Collector(opts);
  const wrapped = wrapLanguageModel({
    model: model as any,
    middleware: debuggerMiddleware(collector),
  });
  return {
    model: wrapped,
    tools: (tools) => instrumentTools(tools, collector),
    collector,
    capture: (fn) => withEnvCaptureIfAvailable(collector, fn),
    finish: (result) => collector.finish(result),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
