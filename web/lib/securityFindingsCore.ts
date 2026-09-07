/**
 * Pure security-finding crypto — no DB, no I/O — mirroring
 * web/lib/narrativesCore.ts's split between pure crypto (this file) and
 * persistence (securityFindings.ts).
 *
 * A finding row is a signed, chained artifact: an external guardrail
 * vendor's observation about a run, sealed the moment it's ingested. Unlike
 * a narrative (Initiative 1/3), a finding isn't AI-generated — it's raw
 * third-party evidence — but it needs the exact same two guarantees:
 *   1. Chain integrity — this finding hasn't been altered, reordered, or
 *      deleted relative to the org's other findings.
 *   2. Payload integrity — the stored fields (vendor, rule, severity,
 *      verdict, raw_finding) still match what was originally signed, so a
 *      finding can't be quietly softened or reworded after the fact.
 *
 * There is deliberately no content_digest/current-digest check here (unlike
 * narratives): a finding doesn't describe a run's CURRENT state, it records
 * what a vendor observed at a point in time — that observation doesn't go
 * stale the way a narrative about live evidence can.
 */
import { sha256, canonical } from "@runback/replay";
import { sign, verifySignature, type Signature, type SignatureVerdict } from "@/lib/signing";

export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type FindingVerdict = "flagged" | "blocked" | "allowed";

export interface FindingPayloadInput {
  org_id: string;
  run_id: string | null;
  span_id: string | null;
  vendor: string;
  rule: string;
  severity: FindingSeverity;
  verdict: FindingVerdict;
  detail: string;
  raw_finding: unknown;
  prev_hash: string;
}

/** The exact payload that gets hashed and signed — every field that must be pinned. */
export function findingPayloadHash(input: FindingPayloadInput): string {
  return sha256(canonical(input));
}

export const findingEntryHash = (prevHash: string, payloadHash: string): string =>
  sha256(prevHash + payloadHash);

export interface SignedFindingChainLink {
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
  signature: Signature;
}

/** Build the full chain link (hash + signature) for a new finding row. Throws if unsigned — same discipline as narrativesCore.ts's buildNarrativeChainLink. */
export function buildFindingChainLink(input: FindingPayloadInput): SignedFindingChainLink {
  const payload_hash = findingPayloadHash(input);
  const entry_hash = findingEntryHash(input.prev_hash, payload_hash);
  const signature = sign(entry_hash);
  if (!signature) {
    throw new Error(
      "[security-findings] Neither AUDIT_ED25519_PRIVATE_KEY nor AUDIT_SIGNING_KEY is set — cannot sign findings"
    );
  }
  return { payload_hash, prev_hash: input.prev_hash, entry_hash, signature };
}

export interface FindingVerification {
  chainValid: boolean;
  payloadValid: boolean;
  signatureVerdict: SignatureVerdict;
  verified: boolean; // chainValid && payloadValid && signatureVerdict === "valid"
}

/** Re-derive and check a stored finding row against its claimed hashes and signature. */
export function verifyFinding(
  row: {
    org_id: string; run_id: string | null; span_id: string | null; vendor: string; rule: string;
    severity: FindingSeverity; verdict: FindingVerdict; detail: string; raw_finding: unknown;
    payload_hash: string; prev_hash: string; entry_hash: string; signature: Signature;
  },
  hmacKeys: string[]
): FindingVerification {
  const expectedPayloadHash = findingPayloadHash({
    org_id: row.org_id, run_id: row.run_id, span_id: row.span_id, vendor: row.vendor, rule: row.rule,
    severity: row.severity, verdict: row.verdict, detail: row.detail, raw_finding: row.raw_finding,
    prev_hash: row.prev_hash,
  });
  const payloadValid = expectedPayloadHash === row.payload_hash;
  const chainValid = findingEntryHash(row.prev_hash, row.payload_hash) === row.entry_hash;
  const signatureVerdict = verifySignature(row.entry_hash, row.signature, hmacKeys);

  return {
    chainValid,
    payloadValid,
    signatureVerdict,
    verified: chainValid && payloadValid && signatureVerdict === "valid",
  };
}
