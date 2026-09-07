import { describe, it, expect } from "vitest";
import { errorRateFires, costSpikeFires } from "../lib/alertEval";
import { estCostUsd, BLENDED_USD_PER_TOKEN } from "../lib/cost";

describe("errorRateFires", () => {
  it("fires when rate ≥ threshold and the sample is large enough", () => {
    expect(errorRateFires(10, 3, 0.2).fires).toBe(true); // 30% ≥ 20%
    expect(errorRateFires(10, 1, 0.2).fires).toBe(false); // 10% < 20%
  });
  it("suppresses small samples so one early failure can't page", () => {
    expect(errorRateFires(1, 1, 0.2).fires).toBe(false); // 100% but n=1
    expect(errorRateFires(5, 1, 0.2).fires).toBe(true); // exactly at min sample, 20%
  });
  it("reports the computed rate", () => {
    expect(errorRateFires(8, 2, 0.5).rate).toBeCloseTo(0.25);
    expect(errorRateFires(0, 0, 0.5).rate).toBe(0);
  });
});

describe("costSpikeFires", () => {
  it("fires when estimated spend over the window meets the USD threshold", () => {
    const tokens = Math.ceil(5 / BLENDED_USD_PER_TOKEN); // ~$5 of tokens
    expect(estCostUsd(tokens)).toBeGreaterThanOrEqual(5);
    expect(costSpikeFires(tokens, 5).fires).toBe(true);
    expect(costSpikeFires(tokens, 50).fires).toBe(false);
  });
  it("never fires on a zero/negative threshold", () => {
    expect(costSpikeFires(1_000_000_000, 0).fires).toBe(false);
    expect(costSpikeFires(1_000_000_000, -1).fires).toBe(false);
  });
  it("reports the estimated USD", () => {
    expect(costSpikeFires(1_000_000, 999).usd).toBeCloseTo(estCostUsd(1_000_000));
  });
});
