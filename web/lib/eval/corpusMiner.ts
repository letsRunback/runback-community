/**
 * Pure helpers for web/app/api/cron/corpus-miner/route.ts — extracted so the
 * dedup/ranking logic is unit-testable without a database, mirroring how
 * ledgerCore.ts/narrativesCore.ts split pure logic from the route/DB layer
 * elsewhere in this codebase.
 */

/** Stable key identifying one failure signal, used both to check
 *  ad_corpus_mined_signals and to write to it — must match exactly on both
 *  sides or a signal could be mined twice. */
export function minedSignalKey(orgId: string, kind: string, signalRef: string): string {
  return `${orgId}|${kind}|${signalRef}`;
}

/**
 * Most-recent-first, capped — a fixed daily cost ceiling per org regardless
 * of how many real failures happened. Stable sort (Array.prototype.sort is
 * stable in Node/V8) so candidates with identical timestamps keep their
 * original relative order instead of shuffling between runs.
 */
export function rankAndCapCandidates<T extends { tsStart: string }>(candidates: T[], cap: number): T[] {
  return [...candidates].sort((a, b) => (a.tsStart < b.tsStart ? 1 : a.tsStart > b.tsStart ? -1 : 0)).slice(0, Math.max(0, cap));
}

/**
 * Content-level dedup for mined scenarios — on top of, not instead of,
 * minedSignalKey's dedup above. That key stops the SAME production incident
 * from being re-mined; it does nothing to stop two DIFFERENT signals
 * producing near-identical scenario text over time (e.g. the same generic
 * "ignore prior instructions" prompt-injection phrasing surfacing from ten
 * different policy-block signals). Jaccard similarity over word sets is
 * simple and dependency-free — exact wording matters far less here than
 * whether the corpus is accumulating repeats instead of real coverage.
 */
function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

export function textSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** True if `candidate` is a near-duplicate (>= threshold Jaccard similarity)
 *  of anything already in `existing`. Default 0.8 — high enough that two
 *  scenarios probing genuinely different weak spots don't collide, low
 *  enough to catch paraphrases of the same attack. */
export function isNearDuplicateText(candidate: string, existing: string[], threshold = 0.8): boolean {
  return existing.some((e) => textSimilarity(candidate, e) >= threshold);
}
