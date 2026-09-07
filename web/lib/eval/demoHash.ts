/**
 * FNV-1a — a stable per-item signal so demo output (runner.ts's zero-cost
 * simulation, and pairwise.ts's simulated judge verdicts) reproduces
 * identically on every run, instead of looking randomly flaky.
 */
export function demoHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
