/**
 * The drift z-score's rate-metric denominator (error_rate, success_rate).
 *
 * Before rateFloor(), the denominator was Math.max(std, EPSILON) with
 * EPSILON = 1e-9. Any agent with a near-constant baseline rate — 0% errors
 * for three weeks, the common case at low volume — collapsed std toward
 * zero, so a single error in a small current-window sample produced an
 * astronomical z-score and an automatic "critical" alert regardless of
 * sample size. rateFloor replaces the fixed epsilon with the actual sampling
 * noise a proportion has at the current window's size, so the alert reflects
 * whether the deviation is statistically real, not just nonzero.
 */
import { describe, it, expect } from "vitest";
import { rateFloor } from "@/lib/drift";

describe("drift rateFloor", () => {
  it("does not blow up to an astronomical z-score for a tiny deviation from a zero-variance baseline", () => {
    // Baseline: 0% errors, dead constant (std = 0). Current: 1 error in 100 runs.
    const bErrMu = 0, cErrRate = 0.01, cRuns = 100;
    const denomOld = 1e-9; // the old, unfixed floor
    const denomNew = rateFloor(bErrMu, cRuns);

    const zOld = (cErrRate - bErrMu) / denomOld;
    const zNew = (cErrRate - bErrMu) / denomNew;

    const Z_INFO = 1.5; // drift.ts's own "worth a look" threshold — below this, severity is "ok"
    expect(zOld).toBeGreaterThan(1_000_000); // the bug: an absurd, sample-size-blind z-score
    expect(zNew).toBeLessThan(Z_INFO); // the fix: 1/100 against a historically-clean agent doesn't even clear "info"
  });

  it("still flags a deviation that IS large relative to the current sample size", () => {
    // Same zero-variance baseline, but now 3 errors in 10 runs — a real shift.
    const bErrMu = 0, cErrRate = 0.3, cRuns = 10;
    const z = (cErrRate - bErrMu) / rateFloor(bErrMu, cRuns);
    expect(z).toBeGreaterThan(3); // still crosses the critical threshold — this one is real
  });

  it("shrinks as the current sample size grows, for the same observed rate", () => {
    const small = rateFloor(0, 5);
    const large = rateFloor(0, 500);
    expect(large).toBeLessThan(small);
  });

  it("never returns zero, even at the 0/1 rate extremes", () => {
    expect(rateFloor(0, 1000)).toBeGreaterThan(0);
    expect(rateFloor(1, 1000)).toBeGreaterThan(0);
  });
});
