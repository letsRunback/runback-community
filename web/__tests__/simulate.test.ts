import { describe, it, expect } from "vitest";
import { simulateStep, simulateRunStep } from "../lib/replay/simulate";
import type { LlmEvent } from "@runback/schema";

const baseEvent: LlmEvent = {
  type: "llm",
  run_id: "run_1",
  span_id: "span_1",
  ts_start: "2026-01-01T00:00:00.000Z",
  ts_end: "2026-01-01T00:00:01.000Z",
  model: { provider: "openai", model_id: "gpt-4o" },
  request: {
    system: "You are helpful.",
    messages: [{ role: "user", content: "What is the capital of France?" }],
    tools: [],
    params: {},
  },
  response: {
    text: "The capital of France is Paris. It has been the capital since 987 AD.",
    reasoning: null,
    finish_reason: "stop",
    tool_calls: [],
  },
  usage: { input_tokens: 20, output_tokens: 18, total_tokens: 38 },
  latency_ms: 600,
} as unknown as LlmEvent;

describe("simulateStep (replay)", () => {
  it("reproduces the captured response exactly when the model is unchanged", () => {
    const r = simulateStep({ original: baseEvent, modelId: "gpt-4o" });
    expect(r.edited).toBe(false);
    expect(r.response.text).toBe(baseEvent.response.text);
    expect(r.demo).toBe(true);
  });

  it("produces a DIFFERENT answer for a different model", () => {
    const r = simulateStep({ original: baseEvent, modelId: "claude-haiku-4-5-20251001" });
    expect(r.edited).toBe(true);
    expect(r.response.text).not.toBe(baseEvent.response.text);
    expect(r.model.model_id).toBe("claude-haiku-4-5-20251001");
  });

  it("is deterministic — same inputs yield identical output", () => {
    const a = simulateStep({ original: baseEvent, modelId: "claude-sonnet-4-6" });
    const b = simulateStep({ original: baseEvent, modelId: "claude-sonnet-4-6" });
    expect(a).toEqual(b);
  });

  it("never calls a provider — pure/synchronous, no key needed", () => {
    // No env keys set in test; if it called a provider this would throw or hang.
    const r = simulateStep({ original: baseEvent, modelId: "gpt-4.1" });
    expect(r.response.usage?.total_tokens).toBeGreaterThan(0);
    expect(r.latency_ms).toBeGreaterThan(0);
  });
});

describe("simulateRunStep (eval / whole-run)", () => {
  it("returns a well-formed RunStepResult with no captured response", () => {
    const r = simulateRunStep({ request: baseEvent.request, model: baseEvent.model, model_id: "claude-haiku-4-5-20251001" });
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.output.text).toBeTruthy();
    expect(r.output.total_tokens).toBeGreaterThan(0);
    expect(r.model.model_id).toBe("claude-haiku-4-5-20251001");
  });
});
