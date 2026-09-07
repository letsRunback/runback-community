import { describe, it, expect } from "vitest";
import { bisect, bisectCandidates } from "../src/bisect";

describe("bisect (binary search for the regression)", () => {
  it("finds the first BAD index in a monotone good→bad sequence", async () => {
    // good,good,good,BAD,bad,bad — culprit at index 3
    const good = (i: number) => i < 3;
    const r = await bisect(6, good);
    expect(r.firstBadIndex).toBe(3);
    expect(r.lastGoodIndex).toBe(2);
  });

  it("uses O(log n) probes, not O(n)", async () => {
    const r = await bisect(64, (i) => i < 40);
    expect(r.firstBadIndex).toBe(40);
    expect(r.comparisons).toBeLessThanOrEqual(7); // ceil(log2 64) = 6 (+1 slack)
    expect(r.comparisons).toBeLessThan(64);
  });

  it("reports no regression when every candidate is good", async () => {
    const r = await bisect(8, () => true);
    expect(r.firstBadIndex).toBeNull();
    expect(r.lastGoodIndex).toBe(7);
  });

  it("flags index 0 when the first candidate already fails", async () => {
    const r = await bisect(8, () => false);
    expect(r.firstBadIndex).toBe(0);
    expect(r.lastGoodIndex).toBeNull();
  });

  it("handles a single candidate and an empty range", async () => {
    expect((await bisect(1, () => false)).firstBadIndex).toBe(0);
    expect((await bisect(0, () => false)).firstBadIndex).toBeNull();
  });

  it("never probes the same index twice", async () => {
    const seen: number[] = [];
    await bisect(20, (i) => {
      seen.push(i);
      return i < 13;
    });
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("bisectCandidates", () => {
  it("identifies the culprit candidate and the last good one", async () => {
    const versions = ["v10", "v11", "v12", "v13", "v14", "v15"];
    // v14 (index 4) removed the escalation rule — first bad.
    const r = await bisectCandidates(
      versions,
      (v) => v,
      (v) => v !== "v14" && v !== "v15"
    );
    expect(r.culprit).toBe("v14");
    expect(r.lastGood).toBe("v13");
    expect(r.comparisons).toBeLessThan(versions.length);
  });
});
