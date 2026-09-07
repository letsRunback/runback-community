import { describe, it, expect } from "vitest";
import {
  argValueFloor, computeFieldBaseline, scoreValue, flatNumericFields, computeAnomalies,
  type ToolCallSample,
} from "../toolAnomalyCore";

describe("argValueFloor — the anomaly-score denominator floor", () => {
  it("does not collapse to ~0 for a dead-constant baseline (the exact drift.ts bug, applied here proactively)", () => {
    const floor = argValueFloor([100, 100, 100, 100, 100]);
    expect(floor).toBeGreaterThan(1e-6);
  });

  it("floors on a fraction of the observed range when the baseline actually varies", () => {
    const floor = argValueFloor([80, 90, 100, 110, 120]); // range 40
    expect(floor).toBeCloseTo(4, 5); // 10% of range
  });

  it("falls back to a fraction of the mean when the range is ~0 but the mean isn't", () => {
    const floor = argValueFloor([250, 250, 250]);
    expect(floor).toBeCloseTo(25, 5); // 10% of mean
  });

  it("falls back to an absolute floor when both range and mean are ~0", () => {
    expect(argValueFloor([0, 0, 0])).toBe(1);
  });

  it("never returns 0 or less, even on empty input", () => {
    expect(argValueFloor([])).toBeGreaterThan(0);
  });
});

describe("scoreValue", () => {
  it("scores a value at the mean as ~0", () => {
    const baseline = computeFieldBaseline([100, 100, 100, 100, 100]);
    expect(scoreValue(100, baseline)).toBeCloseTo(0, 5);
  });

  it("does not blow up to an astronomical z-score for a small deviation from a constant baseline", () => {
    const baseline = computeFieldBaseline([100, 100, 100, 100, 100]);
    const z = scoreValue(105, baseline); // 5% over a dead-constant baseline
    expect(z).toBeLessThan(10); // real, but not the 1e-9-denominator absurdity
  });

  it("still flags a genuinely large deviation from a constant baseline", () => {
    const baseline = computeFieldBaseline([100, 100, 100, 100, 100]);
    const z = scoreValue(10_000, baseline);
    expect(z).toBeGreaterThan(50);
  });
});

describe("flatNumericFields", () => {
  it("keeps only top-level finite-numeric fields", () => {
    expect(flatNumericFields({ amount: 250, note: "hi", nested: { x: 1 }, list: [1, 2], bad: NaN })).toEqual({ amount: 250 });
  });

  it("returns empty for non-object input (arrays, primitives, null)", () => {
    expect(flatNumericFields(null)).toEqual({});
    expect(flatNumericFields("string")).toEqual({});
    expect(flatNumericFields([1, 2, 3])).toEqual({});
  });
});

describe("computeAnomalies", () => {
  const sample = (run_id: string, amount: number, daysAgo: number): ToolCallSample => ({
    run_id, tool_name: "issue_refund", ts_start: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
    input: { amount },
  });

  it("flags a recent call whose argument is a real outlier against the tool's own baseline", () => {
    const baseline = Array.from({ length: 10 }, (_, i) => sample(`b${i}`, 100, 30 - i));
    const recent = [sample("r1", 50_000, 1)]; // wildly higher than the $100 baseline
    const byTool = new Map([["issue_refund", [...baseline, ...recent]]]);
    const flags = computeAnomalies(byTool, new Set(), 1);
    expect(flags.some((f) => f.run_id === "r1" && f.field === "amount")).toBe(true);
  });

  it("does not flag a recent call within normal variance", () => {
    const baseline = Array.from({ length: 10 }, (_, i) => sample(`b${i}`, 95 + (i % 3) * 5, 30 - i));
    const recent = [sample("r1", 100, 1)]; // squarely within the 95-105 baseline range
    const byTool = new Map([["issue_refund", [...baseline, ...recent]]]);
    expect(computeAnomalies(byTool, new Set(), 1)).toEqual([]);
  });

  it("skips a tool with too little history to form a real baseline", () => {
    const tooFew = Array.from({ length: 3 }, (_, i) => sample(`b${i}`, 100, 10 - i));
    const byTool = new Map([["issue_refund", [...tooFew, sample("r1", 999_999, 1)]]]);
    expect(computeAnomalies(byTool, new Set(), 1)).toEqual([]);
  });

  it("marks a flag as covered when an active policy rule names the tool", () => {
    const baseline = Array.from({ length: 10 }, (_, i) => sample(`b${i}`, 100, 30 - i));
    const byTool = new Map([["issue_refund", [...baseline, sample("r1", 50_000, 1)]]]);
    const flags = computeAnomalies(byTool, new Set(["issue_refund"]), 1);
    expect(flags[0].covered).toBe(true);
  });

  it("sorts uncovered-tool anomalies before covered ones, regardless of z-score magnitude", () => {
    const mkTool = (tool: string, outlierAmount: number) => {
      const baseline = Array.from({ length: 10 }, (_, i) => ({ ...sample(`b-${tool}-${i}`, 100, 30 - i), tool_name: tool }));
      const outlier = { ...sample(`r-${tool}`, outlierAmount, 1), tool_name: tool };
      return [...baseline, outlier];
    };
    const byTool = new Map([
      ["covered_tool", mkTool("covered_tool", 1_000_000)], // huge z-score, but covered
      ["uncovered_tool", mkTool("uncovered_tool", 500)],   // smaller z-score, but uncovered
    ]);
    const flags = computeAnomalies(byTool, new Set(["covered_tool"]), 1);
    expect(flags[0].tool_name).toBe("uncovered_tool");
    expect(flags[0].covered).toBe(false);
  });

  it("caps recentCount at half the available samples, so a small tool doesn't get starved to zero baseline", () => {
    // 11 total samples, default recentCount=20 — naively that consumes every
    // sample into "recent" and leaves nothing to score against. The function
    // must cap it instead of silently producing no flags at all.
    const baseline = Array.from({ length: 10 }, (_, i) => sample(`b${i}`, 100, 30 - i));
    const outlier = sample("r1", 50_000, 1);
    const byTool = new Map([["issue_refund", [...baseline, outlier]]]);
    const flags = computeAnomalies(byTool, new Set()); // default recentCount=20, only 11 samples total
    expect(flags.some((f) => f.run_id === "r1")).toBe(true);
  });
});
