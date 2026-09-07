/**
 * Derive a run's cassette digest from its recorded trace events.
 *
 * The "oracle stream" of a run is everything the agent's pure logic received from
 * outside: each model response (given its exact request) and each tool output
 * (given its input). Content-address and hash-chain that stream and you get a
 * `cassette_digest` that the agent must reproduce on a faithful replay.
 *
 * This is the FUSION GLUE: the SDK computes it at capture time and the server
 * computes it when building/verifying an audit record — from the same code, so
 * the digests are identical by construction. An audit record can therefore carry
 * a proof that its recording is the deterministic oracle stream of the run.
 */
import type { TraceEvent } from "@runback/schema";
import { chainStep, sha256, oracleEntryOf } from "./cassette";

export const CASSETTE_ALGORITHM = "oracle-chain/sha256" as const;

export interface RunCassetteDigest {
  digest: string;
  entry_count: number;
  algorithm: typeof CASSETTE_ALGORITHM;
}

/** One step of the oracle chain: the event seq it came from, its kind, and the
 *  running chain hash AFTER it. The ordered `hash` list is the attested chain a
 *  verifier compares against to pinpoint the exact step a tampered run diverges. */
export interface CassetteChainStep {
  seq: number;
  kind: string;
  hash: string;
}

export interface RunCassetteChain extends RunCassetteDigest {
  steps: CassetteChainStep[];
}

/**
 * Compute the deterministic oracle stream AND its per-step running hashes.
 *
 * ONE definition of "what enters the chain" (oracleEntryOf): llm + tool oracle AND
 * env reads (clock/random/uuid/date/fetch); envelopes return null. The per-step
 * `hash` after each entry is what lets a verifier name the EXACT step a tampered
 * recording first departs from the attested chain — not just "something changed".
 */
export function cassetteChainFromEvents(events: TraceEvent[]): RunCassetteChain {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let prev = "";
  const steps: CassetteChainStep[] = [];
  for (const e of ordered) {
    const entry = oracleEntryOf(e);
    if (!entry) continue;
    prev = chainStep(prev, entry);
    steps.push({ seq: e.seq, kind: entry.kind, hash: prev });
  }
  return { digest: prev || sha256(""), entry_count: steps.length, algorithm: CASSETTE_ALGORITHM, steps };
}

/** Compute the deterministic oracle-stream digest for a run's events. */
export function cassetteDigestFromEvents(events: TraceEvent[]): RunCassetteDigest {
  const { digest, entry_count, algorithm } = cassetteChainFromEvents(events);
  return { digest, entry_count, algorithm };
}
