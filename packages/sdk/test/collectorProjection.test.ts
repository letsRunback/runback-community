import { describe, it, expect } from "vitest";
import { Collector } from "../src/collector";

const tool = (c: Collector, requestId: string) =>
  c.recordTool({
    tool_name: "search",
    tool_call_id: "1",
    input: { q: "hi", request_id: requestId },
    output: { hits: 3 },
    latency_ms: 1,
    error: null,
    ts_start: "2026-01-01T00:00:00.000Z",
  });

describe("Collector key projection (H2, capture side)", () => {
  it("capture-time digest is STABLE when only a dropped volatile field differs", () => {
    const opts = { runName: "t", keyProjection: { tools: { search: { drop: ["request_id"] } } } };
    const a = new Collector(opts);
    tool(a, "r1");
    const b = new Collector(opts);
    tool(b, "r2");
    expect(a.cassetteDigest().digest).toBe(b.cassetteDigest().digest);
  });

  it("without projection, the volatile field changes the digest (proves projection is doing it)", () => {
    const a = new Collector({ runName: "t" });
    tool(a, "r1");
    const b = new Collector({ runName: "t" });
    tool(b, "r2");
    expect(a.cassetteDigest().digest).not.toBe(b.cassetteDigest().digest);
  });
});
