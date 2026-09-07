/**
 * Tool-call anomaly scoring — the pure statistics, no DB (see lib/toolAnomaly.ts
 * for the data layer). This is deliberately NOT part of the live blocking path:
 * the in-process pre-hook (packages/policy) stays synchronous and network-free
 * by design (see /security's "no network in your agent's critical path"), and
 * a statistical outlier score is inherently probabilistic — exactly the kind
 * of black-box judgment call that should never be the thing that blocks. This
 * runs after ingest and produces something to put in front of a human, not an
 * allow/deny verdict.
 */

const EPSILON = 1e-9;

/**
 * Standard-error floor for an arbitrary numeric argument (a dollar amount, a
 * count, anything) — sized to the observed spread of the baseline instead of
 * a fixed constant. A near-constant baseline (every historical call used the
 * same value) otherwise collapses std toward zero, and — as with the drift
 * detector's rate metrics before rateFloor() — any nonzero deviation then
 * produces an astronomical z-score regardless of whether it's meaningful.
 * Floors on 10% of the observed range, then 10% of the mean, then a small
 * absolute floor as a last resort for a baseline that's a single repeated
 * value at or near zero.
 */
export function argValueFloor(baseline: number[]): number {
  if (baseline.length === 0) return EPSILON;
  const min = Math.min(...baseline);
  const max = Math.max(...baseline);
  const range = max - min;
  if (range > EPSILON) return 0.1 * range;
  const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
  if (Math.abs(mean) > EPSILON) return 0.1 * Math.abs(mean);
  return 1; // every historical call used ~0 — an absolute floor, not a proportional one
}

export interface FieldBaseline {
  mean: number;
  std: number;
  floor: number;
  n: number;
}

export function computeFieldBaseline(samples: number[]): FieldBaseline {
  const n = samples.length;
  const mean = n ? samples.reduce((s, v) => s + v, 0) / n : 0;
  const variance = n > 1 ? samples.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, std: Math.sqrt(variance), floor: argValueFloor(samples), n };
}

export function scoreValue(value: number, baseline: FieldBaseline): number {
  const denom = Math.max(baseline.std, baseline.floor, EPSILON);
  return (value - baseline.mean) / denom;
}

/** Only flat, top-level, finite-numeric fields — nested objects/arrays are out of scope for this pass. */
export function flatNumericFields(input: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export const Z_REVIEW = 3.0; // matches drift.ts's Z_CRITICAL — same "this is a real deviation" bar

export interface ToolCallSample {
  run_id: string;
  tool_name: string;
  ts_start: string;
  input: unknown;
}

export interface AnomalyFlag {
  run_id: string;
  tool_name: string;
  field: string;
  value: number;
  baseline_mean: number;
  z_score: number;
  /** Whether any active policy rule even names this tool — see lib/eval/policyCoverage.ts. */
  covered: boolean;
}

const MIN_BASELINE = 5; // fewer than this and a baseline is noise, not a distribution

/**
 * Baseline = all but the most recent `recentCount` calls to a tool; recent =
 * the newest `recentCount`. Flags a recent call's numeric field if it's a
 * real outlier (z_score >= Z_REVIEW) against that tool's own history —
 * per-tool, per-field, never across tools (a $50k wire transfer and a 3-line
 * refund note are not the same distribution). Uncovered tools sort first: an
 * anomaly on a tool nothing else is watching is the more urgent gap.
 */
export function computeAnomalies(
  samplesByTool: Map<string, ToolCallSample[]>,
  coveredTools: Set<string>,
  recentCount = 20
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  for (const [tool, samples] of samplesByTool) {
    if (samples.length < MIN_BASELINE + 1) continue;
    const sorted = [...samples].sort((a, b) => new Date(a.ts_start).getTime() - new Date(b.ts_start).getTime());
    // Capped at half the available samples: a fixed recentCount larger than
    // what a smaller tool actually has would otherwise consume its entire
    // history into "recent" and leave zero baseline to score against — not a
    // crash, just a silent, unexplained gap in coverage for exactly the
    // lower-volume tools where a human is least likely to notice on their own.
    const effectiveRecent = Math.min(recentCount, Math.floor(sorted.length / 2));
    const recent = sorted.slice(-effectiveRecent);
    const baselineSamples = sorted.slice(0, sorted.length - recent.length);
    if (baselineSamples.length < MIN_BASELINE) continue;

    const baselineFields = baselineSamples.map((s) => flatNumericFields(s.input));
    const fieldKeys = new Set<string>();
    for (const f of baselineFields) for (const k of Object.keys(f)) fieldKeys.add(k);

    for (const field of fieldKeys) {
      const baselineValues = baselineFields.map((f) => f[field]).filter((v): v is number => v !== undefined);
      if (baselineValues.length < MIN_BASELINE) continue;
      const baseline = computeFieldBaseline(baselineValues);

      for (const call of recent) {
        const fields = flatNumericFields(call.input);
        const value = fields[field];
        if (value === undefined) continue;
        const z = scoreValue(value, baseline);
        if (Math.abs(z) >= Z_REVIEW) {
          flags.push({
            run_id: call.run_id, tool_name: tool, field, value,
            baseline_mean: baseline.mean, z_score: Math.round(z * 100) / 100,
            covered: coveredTools.has(tool),
          });
        }
      }
    }
  }

  // Uncovered first (the bigger gap), then by how extreme the deviation is.
  return flags.sort((a, b) => {
    if (a.covered !== b.covered) return a.covered ? 1 : -1;
    return Math.abs(b.z_score) - Math.abs(a.z_score);
  });
}
