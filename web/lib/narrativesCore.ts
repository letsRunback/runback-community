/**
 * Pure narrative crypto — no DB, no I/O — so the tamper-evidence primitives
 * are unit testable in isolation, mirroring web/lib/ledgerCore.ts's split
 * between pure crypto (this file) and persistence (narratives.ts).
 *
 * A narrative row is a signed, chained artifact: an LLM-generated
 * explanation (of a bisect divergence or a compliance control's evidence),
 * sealed the moment it's generated, referencing the exact run digest it
 * describes. Two independent things are verified:
 *   1. Chain integrity — this narrative hasn't been altered, reordered, or
 *      deleted relative to the org's other narratives (same hash-chain
 *      shape as the ledger).
 *   2. Provenance — content_digest, embedded in the signed payload, still
 *      matches the run's CURRENT digest, so the narrative can't silently
 *      describe a since-altered version of the run.
 */
import { sha256, canonical } from "@runback/replay";
import { sign, verifySignature, type Signature, type SignatureVerdict } from "@/lib/signing";

export type NarrativeSubject = "bisect" | "model_diff" | "compliance_control";

export interface NarrativePayloadInput {
  org_id: string;
  run_id: string;
  subject: NarrativeSubject;
  subject_ref: string | null;
  content_digest: string;
  model_id: string;
  prompt: unknown;
  output: unknown;
  prev_hash: string;
}

/** The exact payload that gets hashed and signed — every field that must be pinned. */
export function narrativePayloadHash(input: NarrativePayloadInput): string {
  return sha256(canonical(input));
}

export const narrativeEntryHash = (prevHash: string, payloadHash: string): string =>
  sha256(prevHash + payloadHash);

export interface SignedNarrativeChainLink {
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
  signature: Signature;
}

/** Build the full chain link (hash + signature) for a new narrative row. Throws if unsigned — an unsigned narrative undermines the entire "cryptographically pinned" claim, so this must fail loudly, matching trust.ts's buildAttestationToken precedent. */
export function buildNarrativeChainLink(input: NarrativePayloadInput): SignedNarrativeChainLink {
  const payload_hash = narrativePayloadHash(input);
  const entry_hash = narrativeEntryHash(input.prev_hash, payload_hash);
  const signature = sign(entry_hash);
  if (!signature) {
    throw new Error(
      "[narratives] Neither AUDIT_ED25519_PRIVATE_KEY nor AUDIT_SIGNING_KEY is set — cannot sign narratives"
    );
  }
  return { payload_hash, prev_hash: input.prev_hash, entry_hash, signature };
}

export interface NarrativeVerification {
  chainValid: boolean;      // entry_hash correctly derives from prev_hash + payload_hash
  payloadValid: boolean;    // payload_hash correctly derives from the stored fields
  signatureVerdict: SignatureVerdict;
  digestMatches: boolean | null; // null when the caller didn't supply a current digest to compare against
  verified: boolean;        // chainValid && payloadValid && signatureVerdict === "valid" && (digestMatches !== false)
}

/**
 * Re-derive and check a stored narrative row against its claimed hashes and
 * signature, and optionally against the run's CURRENT content_digest (pass
 * `currentContentDigest` when available — the CLI and API route both have
 * it; a standalone offline check of just the exported row does not, and
 * digestMatches is `null` in that case rather than a false failure).
 */
export function verifyNarrative(
  row: {
    org_id: string; run_id: string; subject: NarrativeSubject; subject_ref: string | null;
    content_digest: string; model_id: string; prompt: unknown; output: unknown;
    payload_hash: string; prev_hash: string; entry_hash: string; signature: Signature;
  },
  hmacKeys: string[],
  currentContentDigest?: string
): NarrativeVerification {
  const expectedPayloadHash = narrativePayloadHash({
    org_id: row.org_id, run_id: row.run_id, subject: row.subject, subject_ref: row.subject_ref,
    content_digest: row.content_digest, model_id: row.model_id, prompt: row.prompt, output: row.output,
    prev_hash: row.prev_hash,
  });
  const payloadValid = expectedPayloadHash === row.payload_hash;
  const chainValid = narrativeEntryHash(row.prev_hash, row.payload_hash) === row.entry_hash;
  const signatureVerdict = verifySignature(row.entry_hash, row.signature, hmacKeys);
  const digestMatches = currentContentDigest === undefined ? null : currentContentDigest === row.content_digest;

  return {
    chainValid,
    payloadValid,
    signatureVerdict,
    digestMatches,
    verified: chainValid && payloadValid && signatureVerdict === "valid" && digestMatches !== false,
  };
}
