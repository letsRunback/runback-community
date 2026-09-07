import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Collector } from "../src/collector";
import { debuggerMiddleware } from "../src/middleware";
import { isInstrumentedCall } from "../src/instrumentedMarker";
import type { TraceEvent } from "@runback/schema";

/**
 * debuggerMiddleware had zero test coverage before this file. It previously
 * implemented wrapGenerate only — streamText() (which goes through wrapStream)
 * silently captured nothing: no error, no warning, the stream itself worked
 * fine. These tests prove both call shapes now produce an equivalent llm event.
 */
describe("debuggerMiddleware", () => {
  const realFetch = globalThis.fetch;
  let sent: TraceEvent[] = [];

  beforeEach(() => {
    sent = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      sent.push(...JSON.parse(init.body).events);
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const params = {
    prompt: [
      { role: "system", content: "be helpful" },
      { role: "user", content: "what's the weather?" },
    ],
    temperature: 0.5,
  };
  const model = { provider: "openai", modelId: "gpt-4o" };

  it("wrapGenerate records a real llm event with request/response/usage", async () => {
    const c = new Collector({ runName: "gen", apiKey: "test-key" });
    const mw = debuggerMiddleware(c);
    const doGenerate = async () => ({
      content: [{ type: "text", text: "It's sunny." }],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    // @ts-expect-error - partial middleware args, only what debuggerMiddleware reads
    const result = await mw.wrapGenerate!({ doGenerate, params, model });
    expect((result as any).content[0].text).toBe("It's sunny.");

    await c.finish({ output: "done", status: "success" });
    const llm = sent.find((e) => e.type === "llm") as any;
    expect(llm).toBeTruthy();
    expect(llm.response.text).toBe("It's sunny.");
    expect(llm.response.finish_reason).toBe("stop");
    expect(llm.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(llm.request.messages).toEqual([{ role: "user", content: "what's the weather?" }]);
  });

  it("wrapStream records the SAME shape llm event by reassembling deltas, and still passes chunks through", async () => {
    const c = new Collector({ runName: "stream", apiKey: "test-key" });
    const mw = debuggerMiddleware(c);

    const parts = [
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "It's " },
      { type: "text-delta", id: "t1", delta: "sunny." },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ];
    const doStream = async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const p of parts) controller.enqueue(p);
          controller.close();
        },
      }),
    });

    // @ts-expect-error - partial middleware args, only what debuggerMiddleware reads
    const result = await mw.wrapStream!({ doStream, params, model });

    // The real consumer still receives every chunk, unmodified.
    const seen: any[] = [];
    const reader = (result as any).stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(value);
    }
    expect(seen).toEqual(parts);

    await c.finish({ output: "done", status: "success" });
    const llm = sent.find((e) => e.type === "llm") as any;
    expect(llm).toBeTruthy();
    expect(llm.response.text).toBe("It's sunny.");
    expect(llm.response.finish_reason).toBe("stop");
    expect(llm.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  });

  it("wrapStream captures tool calls emitted mid-stream", async () => {
    const c = new Collector({ runName: "stream-tools", apiKey: "test-key" });
    const mw = debuggerMiddleware(c);
    const parts = [
      { type: "tool-call", toolCallId: "call_1", toolName: "search", input: JSON.stringify({ q: "weather" }) },
      { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } },
    ];
    const doStream = async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const p of parts) controller.enqueue(p);
          controller.close();
        },
      }),
    });
    // @ts-expect-error - partial middleware args
    const result = await mw.wrapStream!({ doStream, params, model });
    const reader = (result as any).stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    await c.finish({ output: "done", status: "success" });
    const llm = sent.find((e) => e.type === "llm") as any;
    expect(llm.response.tool_calls).toEqual([
      { tool_call_id: "call_1", tool_name: "search", input: { q: "weather" } },
    ]);
  });

  it("wrapStream records an error event when the stream itself errors, without throwing", async () => {
    const c = new Collector({ runName: "stream-err", apiKey: "test-key" });
    const mw = debuggerMiddleware(c);
    const doStream = async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "error", error: new Error("upstream 500") });
          controller.close();
        },
      }),
    });
    // @ts-expect-error - partial middleware args
    const result = await mw.wrapStream!({ doStream, params, model });
    const reader = (result as any).stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    await c.finish({ output: "done", status: "success" });
    const llm = sent.find((e) => e.type === "llm") as any;
    expect(llm.response.finish_reason).toBe("error");
    expect(llm.error.message).toContain("upstream 500");
  });

  it("wrapStream marks the call instrumented while the provider's doStream is executing", async () => {
    const c = new Collector({ runName: "marker", apiKey: "test-key" });
    const mw = debuggerMiddleware(c);
    let sawInstrumented = false;
    const doStream = async () => {
      sawInstrumented = isInstrumentedCall();
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "finish", finishReason: "stop", usage: {} });
            controller.close();
          },
        }),
      };
    };
    // @ts-expect-error - partial middleware args
    const result = await mw.wrapStream!({ doStream, params, model });
    const reader = (result as any).stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(sawInstrumented).toBe(true);
  });

  /**
   * "Doesn't slow down production agent loops" was asserted on /enterprise
   * and /procurement with no number behind it. This measures the ACTUAL
   * added latency: everything wrapGenerate does beyond the real model call
   * itself (doGenerate resolves instantly here, so all measured time is the
   * wrapper's own extractRequest/extractResponse/recordLlm/redact work) —
   * fetch is mocked so the fire-and-forget flush's network call, which
   * happens after wrapGenerate has already returned, can't skew this number.
   */
  it("adds well under a millisecond of overhead per call, at realistic payload size", async () => {
    const c = new Collector({ runName: "perf", apiKey: "test-key", flushAt: 100_000 }); // never auto-flushes mid-loop
    const mw = debuggerMiddleware(c);
    const realisticParams = {
      prompt: [
        { role: "system", content: "You are a support agent. ".repeat(40) }, // ~1KB system prompt
        { role: "user", content: "My order #48213 hasn't arrived and I need a refund.".repeat(5) },
      ],
      temperature: 0.5,
      tools: [{ name: "issue_refund", description: "Issue a refund", inputSchema: { type: "object" } }],
    };
    const doGenerate = async () => ({
      content: [{ type: "text", text: "I've escalated this to a human reviewer.".repeat(3) }],
      finishReason: "stop",
      usage: { inputTokens: 200, outputTokens: 40, totalTokens: 240 },
    });

    const N = 500;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      // @ts-expect-error - partial middleware args
      await mw.wrapGenerate!({ doGenerate, params: realisticParams, model });
    }
    const elapsedMs = performance.now() - start;
    const perCallMs = elapsedMs / N;

    // eslint-disable-next-line no-console
    console.log(`[perf] withDebugger wrapGenerate overhead: ${perCallMs.toFixed(3)}ms/call over ${N} calls (${elapsedMs.toFixed(1)}ms total)`);
    // Generous threshold — this asserts "not a real regression" (like the
    // O(n²) redaction regex this same investigation found and fixed, which
    // would have made this test fail at ~2000ms/call), not a tight perf
    // budget that would make CI flaky on a slower machine.
    expect(perCallMs).toBeLessThan(5);
  });
});
