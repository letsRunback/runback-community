import { describe, it, expect } from "vitest";
import type { TraceEvent } from "@runback/schema";
import { determinismReport } from "../src/determinism";
import { cassetteDigestFromEvents } from "../src/digest";

const base = (seq: number, type: string, extra: Record<string, unknown>): TraceEvent =>
  ({
    schema_version: 1,
    run_id: "r1",
    span_id: `s${seq}`,
    parent_span_id: null,
    seq,
    ts_start: "2026-01-01T00:00:00.000Z",
    ts_end: "2026-01-01T00:00:00.000Z",
    type,
    ...extra,
  } as unknown as TraceEvent);

const llm = (seq: number) =>
  base(seq, "llm", {
    model: { provider: "openai", model_id: "gpt-4o" },
    request: { system: null, messages: [], tools: [], params: {} },
    response: { text: "ok", reasoning: null, finish_reason: "stop", tool_calls: [] },
    usage: null,
    latency_ms: 10,
    error: null,
  });
const tool = (seq: number) =>
  base(seq, "tool", { tool_name: "search", tool_call_id: "1", input: { q: "x" }, output: { hit: true }, latency_ms: 5, error: null });
const env = (seq: number, kind: string, output: unknown) =>
  base(seq, "env", { kind, key: kind, output });

describe("determinismReport", () => {
  it("reports oracle-only when no environment was captured", () => {
    const r = determinismReport([llm(1), tool(2)]);
    expect(r.level).toBe("oracle-only");
    expect(r.envCaptured).toBe(false);
    expect(r.oracleSteps).toBe(2);
    expect(r.score).toBe(60);
  });

  it("reports full when environment reads are present", () => {
    const r = determinismReport([llm(1), env(2, "now", 1700000000000), env(3, "random", 0.42), tool(4)]);
    expect(r.level).toBe("full");
    expect(r.envCaptured).toBe(true);
    expect(r.counts.now).toBe(1);
    expect(r.counts.random).toBe(1);
    expect(r.score).toBe(100);
  });

  it("reports none for an empty run", () => {
    expect(determinismReport([]).level).toBe("none");
  });
});

describe("cassetteDigestFromEvents with env", () => {
  it("chains env entries and stays deterministic", () => {
    const evs = [llm(1), env(2, "now", 1700000000000), tool(3)];
    const a = cassetteDigestFromEvents(evs);
    const b = cassetteDigestFromEvents([...evs].reverse()); // sorted by seq internally
    expect(a.entry_count).toBe(3);
    expect(a.digest).toBe(b.digest);
  });

  it("a changed env value changes the digest (tamper-evident)", () => {
    const d1 = cassetteDigestFromEvents([llm(1), env(2, "random", 0.1)]);
    const d2 = cassetteDigestFromEvents([llm(1), env(2, "random", 0.2)]);
    expect(d1.digest).not.toBe(d2.digest);
  });

  it("omitting env (legacy runs) chains exactly as before", () => {
    const legacy = cassetteDigestFromEvents([llm(1), tool(2)]);
    expect(legacy.entry_count).toBe(2);
    expect(legacy.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
