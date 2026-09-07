/**
 * The seam between Community modules and the commercially-licensed
 * counterfactual engine (lib/enterprise/replay/wholeRun's
 * counterfactualStoredRun — "replay this recorded run against a DIFFERENT
 * model and report where its decisions diverge").
 *
 * Three Community files call it — lib/golden.ts (candidate-model suite runs),
 * lib/modelDiff.ts, lib/upgradeGate.ts — and in all three the call already
 * sits inside a branch guarded by `deep_replay`. Each of those files also has
 * a genuine free path (golden's integrity mode; modelDiff's and upgradeGate's
 * statistical estimates), which is why they stay Community rather than moving
 * wholesale into lib/enterprise/.
 *
 * The fallback returns null, which every caller ALREADY handles: each wraps
 * the call in `.catch(() => null)` and falls through to its statistical path.
 * So an absent engine degrades to exactly the behaviour a non-entitled org
 * gets today — an honestly-labelled estimate — rather than a fabricated
 * replay result.
 */
import type { ModelDecision } from "@runback/schema";

/**
 * Shape returned by the counterfactual engine — mirrors CounterfactualHybrid
 * structurally so this Community file needs no Enterprise import. ModelDecision
 * comes from @runback/schema, which is already Community, so nothing here
 * reaches into licensed code.
 *
 * Kept in sync by the type-checker rather than by discipline: the bootstrap
 * registers the real engine against this signature, so a drift in either
 * direction fails the build. The narrower first draft of this interface was
 * caught exactly that way.
 */
export interface CounterfactualStep {
  seq: number;
  outcome: "match" | "diverge" | "error";
  recorded: ModelDecision;
  counterfactual?: ModelDecision;
  error?: string;
  tools: { tool_name: string; source: "recorded" | "live-needed" }[];
}

export interface CounterfactualResult {
  totalLlmSteps: number;
  /** Consecutive decision matches from the start — "reproduces through step N". */
  reproducedPrefix: number;
  /** Total steps whose decision differs, across the whole run. */
  divergedSteps: number;
  /** The first divergence; the run continues past it. Null when it matched throughout. */
  frontier: { seq: number; recorded: string; counterfactual: string } | null;
  steps: CounterfactualStep[];
  toolsServedFromCassette: number;
  toolsNeedingLive: number;
  verdict: string;
}

type Counterfactual = (
  runId: string,
  newModelId: string,
  demo: boolean,
  orgId: string | null
) => Promise<CounterfactualResult | null>;

let engine: Counterfactual | null = null;

/** Called by the enterprise bootstrap at import time. Not part of the public API. */
export function registerCounterfactual(fn: Counterfactual): void {
  engine = fn;
}

/** True when the counterfactual replay engine is present in this build. */
export function counterfactualAvailable(): boolean {
  return engine !== null;
}

/**
 * Replay a stored run against a different model. Returns null when no engine
 * is present — the same value callers already treat as "couldn't replay,
 * fall back to the statistical estimate".
 */
export async function counterfactualIfAvailable(
  runId: string,
  newModelId: string,
  demo: boolean,
  orgId: string | null
): Promise<CounterfactualResult | null> {
  if (!engine) return null;
  return engine(runId, newModelId, demo, orgId);
}
