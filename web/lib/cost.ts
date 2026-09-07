/**
 * One blended cost estimate, shared by the dashboard and the alert engine so the
 * "$X spent" a user sees on the overview and the threshold a cost_spike alert
 * fires on are computed identically (no drift between what we show and what we
 * alert on). Deliberately a rough, mixed-model blended rate — an estimate, not a
 * billing source of truth.
 */
export const BLENDED_USD_PER_TOKEN = 3.5 / 1_000_000; // ~$3.50 / 1M tokens, mixed models

/** Estimated USD for a token count, at the blended rate. */
export function estCostUsd(tokens: number): number {
  return (tokens || 0) * BLENDED_USD_PER_TOKEN;
}
