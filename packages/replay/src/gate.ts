/**
 * The CI release gate.
 *
 * A baseline cassette captures a known-good run's deterministic oracle stream
 * (and its digest is what the signed audit record attests to). On every change,
 * the gate replays the CURRENT agent code against that baseline — offline, no
 * model calls, no network — and PASSES only if the agent reproduces the baseline
 * exactly. A behaviour change shows up as a divergence pinpointed to the exact
 * interaction it breaks, and the gate exits non-zero so CI blocks the merge.
 *
 * This is enforcement, not observation: "no agent change ships unless its replay
 * verifies against the baseline." Because the baseline digest equals the audit
 * record's `cassette_digest`, a green gate is also a statement that the shipped
 * agent still reproduces the audited behaviour.
 */
import { replay, type ReplayController, type VerifyOutcome } from "./harness";
import { type Cassette, CASSETTE_SCHEMA, recomputeDigest } from "./cassette";

export interface GateResult {
  passed: boolean;
  verify: VerifyOutcome;
  reason: string;
  baselineDigest: string;
}

/** Validate a parsed baseline cassette and confirm it isn't itself corrupt. */
export function loadCassette(json: unknown): Cassette {
  const c = json as Cassette;
  if (!c || c.schema !== CASSETTE_SCHEMA || !Array.isArray(c.entries)) {
    throw new Error("not a Runback cassette (expected schema " + CASSETTE_SCHEMA + ")");
  }
  if (recomputeDigest(c.entries) !== c.digest) {
    throw new Error("baseline cassette is corrupt — its entries do not match its digest");
  }
  return c;
}

const short = (h: string) => (h ? h.slice(0, 12) + "…" : "—");

/**
 * Replay the agent against the baseline and gate on faithful reproduction.
 * Optionally pin the expected digest (e.g. from a signed audit record) so the
 * gate also fails if the baseline file was swapped.
 */
export async function replayGate(
  baseline: Cassette,
  body: (play: ReplayController) => unknown | Promise<unknown>,
  opts?: { expectDigest?: string }
): Promise<GateResult> {
  if (opts?.expectDigest && opts.expectDigest !== baseline.digest) {
    return {
      passed: false,
      baselineDigest: baseline.digest,
      reason: `baseline mismatch — expected digest ${short(opts.expectDigest)} (e.g. from the signed audit) but the cassette is ${short(baseline.digest)}`,
      verify: { ok: false, consumed: 0, total: baseline.entries.length, reproducedDigest: "", recordedDigest: baseline.digest },
    };
  }

  const { verify } = await replay(baseline, body as (p: ReplayController) => Promise<unknown>);

  if (verify.ok) {
    return {
      passed: true,
      verify,
      baselineDigest: baseline.digest,
      reason: `verified — reproduced cassette ${short(baseline.digest)} (${verify.consumed}/${verify.total} interactions, no live calls)`,
    };
  }
  if (verify.divergedAt) {
    const d = verify.divergedAt;
    return {
      passed: false,
      verify,
      baselineDigest: baseline.digest,
      reason: `agent behaviour changed at interaction ${d.seq}: expected ${d.expected}, got ${d.got}`,
    };
  }
  return {
    passed: false,
    verify,
    baselineDigest: baseline.digest,
    reason: `replay digest mismatch — baseline ${short(verify.recordedDigest)} vs reproduced ${short(verify.reproducedDigest)} (${verify.consumed}/${verify.total})`,
  };
}

/** One-line CI verdict. */
export function formatGateReport(r: GateResult): string {
  return (r.passed ? "✅ runback gate PASSED — " : "❌ runback gate FAILED — ") + r.reason;
}
