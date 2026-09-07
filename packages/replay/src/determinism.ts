/**
 * Determinism score — how reproducible a captured run is.
 *
 * A run reproduces byte-exact only if every value that entered it from outside
 * its pure logic was recorded: the LLM/tool oracle AND the environment reads
 * (clock, randomness, UUIDs, network). This turns that into one honest signal a
 * customer can see on the run page:
 *
 *   • "full"        — environment capture was active for at least one boundary
 *                     this run touched (clock/random/uuid/fetch), so everything
 *                     THROUGH THOSE HOOKS was recorded alongside the oracle.
 *                     NOT a coverage proof: it means capture was on, not that
 *                     every nondeterminism source in the run was one this SDK
 *                     hooks. installEnvCapture() (packages/sdk/src/enterprise/envCapture.ts)
 *                     does not shim crypto.randomBytes/getRandomValues, worker
 *                     threads, or child-process entropy — an agent calling those
 *                     directly introduces nondeterminism "full" cannot see.
 *   • "oracle-only" — only LLM responses + tool outputs were captured (env capture
 *                     off). Reproducible at decision grain, not byte grain.
 *   • "none"        — nothing capturable was recorded.
 *
 * No fabricated percentages: the score is a transparent function of what was
 * actually recorded, with the per-source breakdown shown alongside it.
 */
import type { TraceEvent } from "@runback/schema";

export type DeterminismLevel = "full" | "oracle-only" | "none";

export interface DeterminismReport {
  level: DeterminismLevel;
  /** 0–100, derived from `level` — a badge number, not a claim of coverage. */
  score: number;
  /** Per-source counts of recorded boundaries. */
  counts: { llm: number; tool: number; now: number; date: number; random: number; uuid: number; fetch: number };
  /** Oracle steps (llm + tool). */
  oracleSteps: number;
  /** Environment reads (clock + random + uuid + fetch). */
  envReads: number;
  /** True once any environment boundary was captured. */
  envCaptured: boolean;
  note: string;
}

export function determinismReport(events: TraceEvent[]): DeterminismReport {
  const counts = { llm: 0, tool: 0, now: 0, date: 0, random: 0, uuid: 0, fetch: 0 };
  for (const e of events) {
    if (e.type === "llm") counts.llm++;
    else if (e.type === "tool") counts.tool++;
    else if (e.type === "env") counts[e.kind]++;
  }
  const oracleSteps = counts.llm + counts.tool;
  const envReads = counts.now + counts.date + counts.random + counts.uuid + counts.fetch;
  const envCaptured = envReads > 0;

  let level: DeterminismLevel;
  let note: string;
  if (envCaptured) {
    level = "full";
    note = "Environment capture on — clock, randomness, UUIDs and network were recorded with the LLM/tool oracle. This run replays byte-for-byte through those captured boundaries. Sources this SDK does not shim (crypto.randomBytes/getRandomValues, worker threads, child-process entropy) are not covered, even under \"full\".";
  } else if (oracleSteps > 0) {
    level = "oracle-only";
    note = "Captured LLM responses and tool outputs only. Reproducible at decision grain; enable environment capture for byte-exact replay.";
  } else {
    level = "none";
    note = "No reproducible boundaries were recorded for this run.";
  }
  const score = level === "full" ? 100 : level === "oracle-only" ? 60 : 0;

  return { level, score, counts, oracleSteps, envReads, envCaptured, note };
}
