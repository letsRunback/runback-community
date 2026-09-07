import { describe, it, expect } from "vitest";
import { ingestPayloadSchema, traceEventSchema } from "../src/validate";
import { SCHEMA_VERSION } from "../src/events";

const runEvent = (over: Record<string, unknown> = {}) => ({
  schema_version: SCHEMA_VERSION,
  run_id: "r1",
  span_id: "s1",
  parent_span_id: null,
  seq: 0,
  ts_start: "2026-01-01T00:00:00.000Z",
  ts_end: null,
  type: "run",
  phase: "start",
  name: "agent",
  input: null,
  output: null,
  status: "running",
  error: null,
  metadata: {},
  ...over,
});

describe("actor field survives ingest validation (was silently stripped)", () => {
  it("a real actor object is preserved, not dropped, on a run event", () => {
    const actor = { type: "user", id: "u_42", label: "jane@acme.com" };
    const parsed = traceEventSchema.parse(runEvent({ actor }));
    expect(parsed.actor).toEqual(actor);
  });

  it("survives the full ingestPayloadSchema batch validation too", () => {
    const actor = { type: "api_key", id: "key_abc" };
    const result = ingestPayloadSchema.safeParse({ events: [runEvent({ actor })] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.events[0].actor).toEqual(actor);
    }
  });

  it("actor is optional — an event without one still validates, with actor undefined", () => {
    const parsed = traceEventSchema.parse(runEvent());
    expect(parsed.actor).toBeUndefined();
  });

  it("rejects a malformed actor (unknown type) rather than silently dropping it", () => {
    const result = traceEventSchema.safeParse(runEvent({ actor: { type: "robot", id: "x" } }));
    expect(result.success).toBe(false);
  });

  it("actor also survives on a tool event alongside policy_evaluated (same class of bug)", () => {
    const toolEvent = {
      schema_version: SCHEMA_VERSION,
      run_id: "r1",
      span_id: "s2",
      parent_span_id: "s1",
      seq: 1,
      ts_start: "2026-01-01T00:00:00.000Z",
      ts_end: "2026-01-01T00:00:00.100Z",
      type: "tool",
      tool_name: "search",
      tool_call_id: "c1",
      input: { q: "x" },
      output: { hits: 1 },
      latency_ms: 100,
      error: null,
      actor: { type: "system", id: "cron" },
      policy_evaluated: { passed: true },
    };
    const parsed = traceEventSchema.parse(toolEvent);
    expect(parsed).toMatchObject({
      actor: { type: "system", id: "cron" },
      policy_evaluated: { passed: true },
    });
  });
});
