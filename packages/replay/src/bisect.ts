/**
 * Bisection (H3 application) — "git bisect for agent behaviour".
 *
 * Given an ORDERED sequence of candidates (model upgrades, prompt versions, a
 * change timeline) where the run is GOOD at the start and BAD at the end, binary-
 * search for the exact candidate that flipped it — in O(log n) probes, not O(n).
 * Each probe re-executes the run under one candidate (see web/lib/replay/bisectRun),
 * which is cheap because the hybrid engine serves recorded values on every hit and
 * only the changed axis moves.
 *
 * Assumes the good→bad transition is monotone (the bisect contract). The probe
 * sequence is returned so the result is transparent, not a black box.
 */
export interface BisectOutcome {
  count: number;
  /** First index that is BAD — the culprit. null if every candidate is good. */
  firstBadIndex: number | null;
  /** Last index that is GOOD before the culprit. null if the very first is bad. */
  lastGoodIndex: number | null;
  /** The probes actually evaluated, in order — proof of the search path. */
  probes: { index: number; good: boolean }[];
  /** Number of probes (≈ ceil(log2 count) + 1). */
  comparisons: number;
  verdict: string;
}

/**
 * Binary-search for the first index where `isGood` flips true→false. `isGood` is
 * memoized across the search, so each index is probed at most once.
 */
export async function bisect(
  count: number,
  isGood: (index: number) => boolean | Promise<boolean>
): Promise<BisectOutcome> {
  const probes: { index: number; good: boolean }[] = [];
  const cache = new Map<number, boolean>();
  const probe = async (i: number): Promise<boolean> => {
    const c = cache.get(i);
    if (c !== undefined) return c;
    const g = await isGood(i);
    cache.set(i, g);
    probes.push({ index: i, good: g });
    return g;
  };

  if (count <= 0) {
    return { count: 0, firstBadIndex: null, lastGoodIndex: null, probes, comparisons: 0, verdict: "No candidates to bisect." };
  }

  // Find the first BAD index in [0, count). Classic lower-bound binary search.
  let lo = 0;
  let hi = count; // exclusive; hi == count means "no bad found yet"
  let firstBad: number | null = null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (await probe(mid)) {
      lo = mid + 1; // good ⇒ culprit is to the right
    } else {
      firstBad = mid;
      hi = mid; // bad ⇒ culprit is here or to the left
    }
  }

  const lastGoodIndex = firstBad === null ? count - 1 : firstBad === 0 ? null : firstBad - 1;
  const verdict =
    firstBad === null
      ? `All ${count} candidates reproduce — no regression in this range.`
      : firstBad === 0
        ? `The first candidate already fails — the regression predates this range.`
        : `Regression introduced at candidate #${firstBad} (good through #${firstBad - 1}). Found in ${probes.length} probe${probes.length === 1 ? "" : "s"} across ${count} candidates.`;

  return { count, firstBadIndex: firstBad, lastGoodIndex, probes, comparisons: probes.length, verdict };
}

export interface BisectCandidatesOutcome<T> extends BisectOutcome {
  labels: string[];
  culprit: T | null;
  lastGood: T | null;
}

/**
 * Bisect a labeled candidate list. `probe(candidate, index)` returns true if the
 * run is still GOOD under that candidate.
 */
export async function bisectCandidates<T>(
  candidates: T[],
  label: (c: T) => string,
  probe: (c: T, index: number) => boolean | Promise<boolean>
): Promise<BisectCandidatesOutcome<T>> {
  const out = await bisect(candidates.length, (i) => probe(candidates[i], i));
  return {
    ...out,
    labels: candidates.map(label),
    culprit: out.firstBadIndex === null ? null : candidates[out.firstBadIndex],
    lastGood: out.lastGoodIndex === null ? null : candidates[out.lastGoodIndex],
  };
}
