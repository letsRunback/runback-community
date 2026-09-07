import { describe, it, expect } from "vitest";
import { record, replayGate, loadCassette, formatGateReport } from "../src/index.js";

type Ctrl = { tool: <I, O>(name: string, fn: (i: I) => O | Promise<O>) => (i: I) => Promise<O> };

// A baseline agent: think → call a tool → decide on the result.
function refundAgent(se: { calls: number }) {
  return async (ctrl: Ctrl) => {
    const lookup = ctrl.tool("lookup_customer", async (id: number) => {
      se.calls++;
      return { id, tier: "gold" };
    });
    const roll = Math.random();
    const cust = await lookup(8842);
    return { roll, decision: cust.tier === "gold" ? "escalate" : "refund" };
  };
}

describe("@runback/replay — CI release gate", () => {
  it("PASSES when the agent reproduces the baseline (no live calls)", async () => {
    const { cassette } = await record("baseline", refundAgent({ calls: 0 }));
    const baseline = loadCassette(JSON.parse(JSON.stringify(cassette))); // round-trip like a file

    const se = { calls: 0 };
    const result = await replayGate(baseline, refundAgent(se));
    expect(result.passed).toBe(true);
    expect(se.calls).toBe(0); // replayed offline, tool never executed
    expect(formatGateReport(result)).toContain("PASSED");
  });

  it("FAILS and pinpoints the change when the agent's behaviour diverges", async () => {
    const { cassette } = await record("baseline", refundAgent({ calls: 0 }));

    // a changed agent: calls a DIFFERENT tool → behaviour divergence
    const changed = async (ctrl: Ctrl) => {
      const lookup = ctrl.tool("lookup_account", async () => ({ ok: true })); // different tool name
      Math.random();
      await lookup(1);
      return "x";
    };
    const result = await replayGate(cassette, changed);
    expect(result.passed).toBe(false);
    expect(result.verify.divergedAt).toBeDefined();
    expect(formatGateReport(result)).toContain("FAILED");
  });

  it("FAILS if the baseline was swapped (expected digest pin)", async () => {
    const { cassette } = await record("baseline", refundAgent({ calls: 0 }));
    const result = await replayGate(cassette, refundAgent({ calls: 0 }), {
      expectDigest: "deadbeef".repeat(8), // a digest from a signed audit that won't match
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("baseline mismatch");
  });

  it("rejects a corrupt baseline cassette", () => {
    expect(() => loadCassette({ schema: "runback.cassette/v1", digest: "x", entries: [] })).toThrow();
  });
});
