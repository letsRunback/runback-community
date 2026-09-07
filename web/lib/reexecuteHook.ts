/**
 * The seam between the Community golden suite and the commercially-licensed
 * whole-run re-execution engine (@runback/replay/enterprise's reexecuteRun).
 *
 * lib/golden.ts's integrity mode — replaying each enrolled incident against
 * its own sealed cassette to prove it still reproduces — is genuinely FREE.
 * The route says so explicitly ("The integrity (no-model) run is free and
 * stays open"; only the candidate-model path is gated on deep_replay). So
 * golden.ts is a Community file that legitimately needs a licensed engine,
 * and cannot import it directly without breaking a Community build.
 *
 * The fallback is "unknown", NOT "reproduced" and not "diverged". Both of
 * those would be a lie about an audit artefact: claiming an incident still
 * reproduces without having re-executed it is the more dangerous direction,
 * but silently reporting divergence would send someone chasing a regression
 * that may not exist. Callers surface "unknown" as a distinct, visible state.
 */
import type { TraceEvent } from "@runback/schema";

export interface ReexecuteVerdict {
  /** True only when re-execution actually ran and reproduced the sealed digest. */
  ok: boolean;
  /** False when no engine was available to answer — the verdict is not a judgement. */
  known: boolean;
}

type Reexecutor = (events: TraceEvent[], attestedDigest?: string | null) => { ok: boolean };

let reexecutor: Reexecutor | null = null;

/** Called by the enterprise bootstrap at import time. Not part of the public API. */
export function registerReexecutor(fn: Reexecutor): void {
  reexecutor = fn;
}

/** True when the whole-run re-execution engine is present in this build. */
export function reexecutionAvailable(): boolean {
  return reexecutor !== null;
}

/**
 * Verify a run still reproduces its sealed cassette. Returns `known: false`
 * when this build has no re-execution engine — never a fabricated verdict.
 */
export function verifyReproduces(
  events: TraceEvent[],
  attestedDigest?: string | null
): ReexecuteVerdict {
  if (!reexecutor) return { ok: false, known: false };
  return { ok: reexecutor(events, attestedDigest).ok, known: true };
}
