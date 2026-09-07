import { describe, it, expect } from "vitest";
import type { TraceEvent } from "@runback/schema";
import type { RunRow } from "../lib/runs";
import { buildFrames } from "../lib/replay/timeTravel";

const v = 1 as const;
const run: RunRow = {
  run_id: "r1",
  name: "test-agent",
  status: "error",
  input: "do the thing",
  output: null,
  error: { name: "ToolError", message: "boom" },
  metadata: {},
  step_count: 2,
  total_tokens: 300,
  started_at: "2026-01-01T00:00:00Z",
  ended_at: "2026-01-01T00:00:02Z",
  actor_type: null,
  actor_id: null,
};

const events: TraceEvent[] = [
  { schema_version: v, run_id: "r1", span_id: "s0", parent_span_id: null, seq: 0, ts_start: "", ts_end: null, type: "run", phase: "start", name: "test-agent", input: "do the thing", output: null, status: "running", error: null, metadata: {} },
  { schema_version: v, run_id: "r1", span_id: "l1", parent_span_id: "s0", seq: 1, ts_start: "", ts_end: null, type: "llm", model: { provider: "openai", model_id: "gpt-4o" }, request: { system: "sys", messages: [{ role: "user", content: "do the thing" }], tools: [], params: {} }, response: { text: null, reasoning: null, finish_reason: "tool-calls", tool_calls: [{ tool_call_id: "c1", tool_name: "search", input: { q: "x" } }] }, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, latency_ms: 500, error: null },
  { schema_version: v, run_id: "r1", span_id: "t1", parent_span_id: "l1", seq: 2, ts_start: "", ts_end: null, type: "tool", tool_name: "search", tool_call_id: "c1", input: { q: "x" }, output: { hits: 3 }, latency_ms: 30, error: null },
  { schema_version: v, run_id: "r1", span_id: "l2", parent_span_id: "s0", seq: 3, ts_start: "", ts_end: null, type: "llm", model: { provider: "openai", model_id: "gpt-4o" }, request: { system: "sys", messages: [], tools: [], params: {} }, response: { text: null, reasoning: null, finish_reason: "tool-calls", tool_calls: [] }, usage: { input_tokens: 150, output_tokens: 30, total_tokens: 180 }, latency_ms: 600, error: { name: "ToolError", message: "boom" } },
];

describe("buildFrames — deterministic time-travel replay", () => {
  it("produces one frame per step plus start and end", () => {
    const frames = buildFrames(run, events);
    // start + (llm, tool, llm) + end = 5
    expect(frames.length).toBe(5);
    expect(frames[0].kind).toBe("user");
    expect(frames[frames.length - 1].kind).toBe("run");
  });

  it("is deterministic — identical input yields identical output", () => {
    const a = buildFrames(run, events);
    const b = buildFrames(run, [...events].reverse()); // order must not matter (sorted by seq)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reconstructs a monotonically growing transcript", () => {
    const frames = buildFrames(run, events);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].transcript.length).toBeGreaterThanOrEqual(frames[i - 1].transcript.length);
    }
    expect(frames[0].transcript[0]).toMatchObject({ role: "user" });
  });

  it("accumulates tokens to the run total and flags the failure step", () => {
    const frames = buildFrames(run, events);
    const last = frames[frames.length - 1];
    expect(last.cumTokens).toBe(300); // 120 + 180
    expect(last.isFailure).toBe(true);
    // the failing LLM step is flagged, the successful tool step is not
    const failFrames = frames.filter((f) => f.isFailure);
    expect(failFrames.length).toBe(2); // the errored llm + the end frame
    expect(frames.find((f) => f.span_id === "t1")!.isFailure).toBe(false);
  });

  it("tracks tools called and cost monotonically", () => {
    const frames = buildFrames(run, events);
    expect(frames.find((f) => f.span_id === "t1")!.toolsCalled).toEqual(["search"]);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].cumCostUsd).toBeGreaterThanOrEqual(frames[i - 1].cumCostUsd);
    }
  });

  it("stamps each transcript entry with the frame it first appeared at, so clicking it jumps to the right frame", () => {
    const frames = buildFrames(run, events);
    // Every entry present at frame i must have been stamped with an index <= i
    // (it was introduced at or before this frame), and the newest entries at
    // frame i (the ones frame i-1 doesn't have) must be stamped exactly i.
    for (let i = 0; i < frames.length; i++) {
      for (const entry of frames[i].transcript) {
        expect(entry.frameIndex).toBeLessThanOrEqual(i);
      }
      if (i > 0) {
        const prevLen = frames[i - 1].transcript.length;
        const newEntries = frames[i].transcript.slice(prevLen);
        for (const entry of newEntries) {
          expect(entry.frameIndex).toBe(i);
        }
      }
    }
    // The very first entry (the user's request) belongs to frame 0.
    expect(frames[0].transcript[0].frameIndex).toBe(0);
  });
});
