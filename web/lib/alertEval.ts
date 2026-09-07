/**
 * Pure alert-firing decisions — no DB, no I/O — so the thresholds that page a
 * customer at 3am are unit-testable in isolation. `evaluateRun` (alerts.ts) does
 * the querying/delivery; these decide.
 */
import { estCostUsd } from "./cost";

/**
 * Error-rate decision over a window. Requires a minimum sample so a single early
 * failure (1/1 = 100%) can't trip a "20% error rate" page.
 */
export function errorRateFires(
  total: number,
  errors: number,
  threshold: number,
  minSample = 5
): { fires: boolean; rate: number } {
  const rate = total > 0 ? errors / total : 0;
  return { fires: total >= minSample && rate >= threshold, rate };
}

/**
 * Cost-spike decision over a window. `thresholdUsd` is estimated spend (same
 * blended rate as the dashboard). A zero/negative threshold never fires.
 */
export function costSpikeFires(tokens: number, thresholdUsd: number): { fires: boolean; usd: number } {
  const usd = estCostUsd(tokens);
  return { fires: thresholdUsd > 0 && usd >= thresholdUsd, usd };
}
