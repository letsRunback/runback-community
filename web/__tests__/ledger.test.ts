import { describe, it, expect } from "vitest";
import { runLeaf, merkleRoot, merkleProof, verifyMerkleProof, checkpointTrusted } from "../lib/ledgerCore";

const leafRow = (run_id: string, digest: string) => ({
  run_id, name: "agent", status: "success", cassette_digest: digest, ended_at: "2026-01-01T00:00:00Z", step_count: 3,
});

describe("ledger — leaf + Merkle", () => {
  it("a changed run produces a different leaf (tamper-evident)", () => {
    expect(runLeaf(leafRow("r1", "d1"))).not.toBe(runLeaf(leafRow("r1", "d2")));
    expect(runLeaf(leafRow("r1", "d1"))).toBe(runLeaf(leafRow("r1", "d1"))); // deterministic
  });

  it("Merkle proofs verify against the root and reject a wrong leaf", () => {
    const leaves = ["a", "b", "c", "d", "e"].map((x) => runLeaf(leafRow(x, x)));
    const root = merkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      expect(verifyMerkleProof(leaves[i], merkleProof(leaves, i), root)).toBe(true);
    }
    // a forged leaf is not provable under the same root
    expect(verifyMerkleProof(runLeaf(leafRow("x", "x")), merkleProof(leaves, 0), root)).toBe(false);
  });

  it("leaf and internal-node hashes are domain-separated (no second-preimage)", () => {
    // A single leaf's root must not equal the leaf itself (different domains).
    const leaf = runLeaf(leafRow("r", "d"));
    expect(merkleRoot([leaf, leaf])).not.toBe(leaf);
  });
});

describe("ledger — checkpoint trust (fail-closed)", () => {
  const cp = (over: Partial<{ matchesHead: boolean; matchesRoot: boolean; signatureValid: boolean }> = {}) =>
    ({ matchesHead: true, matchesRoot: true, signatureValid: true, ...over });

  it("no checkpoint → trusted (chain re-derivation stands alone)", () => {
    expect(checkpointTrusted(true, null)).toBe(true);
  });

  it("KEY CONFIGURED: an unsigned checkpoint is REJECTED even if head/root match (the fix)", () => {
    expect(checkpointTrusted(true, cp({ signatureValid: false }))).toBe(false);
  });

  it("KEY CONFIGURED: a valid signature with matching head/root is trusted", () => {
    expect(checkpointTrusted(true, cp())).toBe(true);
  });

  it("NO KEY (self-host never signs): an unsigned checkpoint is accepted on chain match", () => {
    expect(checkpointTrusted(false, cp({ signatureValid: false }))).toBe(true);
  });

  it("a mismatched head or root is never trusted, signed or not", () => {
    expect(checkpointTrusted(true, cp({ matchesHead: false }))).toBe(false);
    expect(checkpointTrusted(false, cp({ matchesRoot: false }))).toBe(false);
  });
});
