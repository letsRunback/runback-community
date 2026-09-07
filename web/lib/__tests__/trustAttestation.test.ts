/**
 * Trust-chain attestations moved off a bespoke, per-org-derived HMAC-only
 * scheme onto the same Ed25519-preferred/HMAC-fallback primitive the per-run
 * audit record signs with (lib/signing.ts) — see lib/trust.ts for why. These
 * tests pin the properties that made the old scheme weaker than intended,
 * and the ones the shared signing module is relied on to hold:
 *  - Ed25519 is used whenever a keypair is configured, and verifies offline
 *    against the pinned public key, mirroring the audit record's rotation
 *    ring (auditEd25519KeyRotation.test.ts).
 *  - HMAC-SHA256 fallback works with no per-org key derivation, and still
 *    rejects a cross-org replay because org_id is part of the signed payload.
 *  - Any mutation to a signed field breaks verification.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, createHash } from "crypto";
import { buildAttestationToken, verifyAttestationToken, type TrustEdge } from "@/lib/trust";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
beforeEach(() => {
  delete process.env.AUDIT_ED25519_PRIVATE_KEY;
  delete process.env.AUDIT_ED25519_PUBLIC_KEY;
  delete process.env.AUDIT_ED25519_PRIVATE_KEY_PREVIOUS;
  delete process.env.AUDIT_ED25519_PUBLIC_KEY_PREVIOUS;
  delete process.env.AUDIT_SIGNING_KEY;
  delete process.env.AUDIT_SIGNING_KEY_PREVIOUS;
});

function edge(orgId: string, overrides: Partial<Omit<TrustEdge, "trust_level">> = {}): Omit<TrustEdge, "trust_level"> {
  const built = buildAttestationToken(orgId, "run_parent", "run_child", "orchestrator", "subagent", 1, ["read:customer"], null);
  return {
    parent_run_id: "run_parent",
    child_run_id: "run_child",
    calling_agent: "orchestrator",
    called_agent: "subagent",
    delegation_depth: 1,
    scope: ["read:customer"],
    attestation_hash: built.attestation_hash,
    signature: built.signature,
    parent_token_hash: null,
    ...overrides,
  };
}

describe("trust attestation signing", () => {
  it("signs with Ed25519 when a keypair is configured, and verifies", () => {
    process.env.AUDIT_ED25519_PRIVATE_KEY = keypair().privatePem;
    const e = edge("org_a");
    expect(e.signature.alg).toBe("Ed25519");
    expect(e.signature.pubkey).toBeTruthy();
    expect(verifyAttestationToken("org_a", e)).toBe("verified");
  });

  it("falls back to HMAC-SHA256 with no per-org key derivation, and verifies", () => {
    process.env.AUDIT_SIGNING_KEY = "shared-secret";
    const e = edge("org_a");
    expect(e.signature.alg).toBe("HMAC-SHA256");
    expect(verifyAttestationToken("org_a", e)).toBe("verified");
  });

  it("rejects a chain replayed under a different org_id (Ed25519)", () => {
    process.env.AUDIT_ED25519_PRIVATE_KEY = keypair().privatePem;
    const e = edge("org_a");
    expect(verifyAttestationToken("org_b", e)).toBe("broken");
  });

  it("rejects a chain replayed under a different org_id (HMAC)", () => {
    process.env.AUDIT_SIGNING_KEY = "shared-secret";
    const e = edge("org_a");
    expect(verifyAttestationToken("org_b", e)).toBe("broken");
  });

  it("detects a tampered scope (attestation_hash mismatch)", () => {
    process.env.AUDIT_ED25519_PRIVATE_KEY = keypair().privatePem;
    const e = edge("org_a", { scope: ["read:customer", "write:customer"] });
    expect(verifyAttestationToken("org_a", e)).toBe("broken");
  });

  it("detects a forged signature value", () => {
    process.env.AUDIT_SIGNING_KEY = "shared-secret";
    const e = edge("org_a");
    e.signature = { ...e.signature, value: "0".repeat(e.signature.value.length) };
    expect(verifyAttestationToken("org_a", e)).toBe("broken");
  });

  it("still verifies an Ed25519-signed edge after key rotation", () => {
    const oldKey = keypair();
    const newKey = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = oldKey.privatePem;
    const e = edge("org_a");

    process.env.AUDIT_ED25519_PRIVATE_KEY = newKey.privatePem;
    process.env.AUDIT_ED25519_PRIVATE_KEY_PREVIOUS = oldKey.privatePem;
    expect(verifyAttestationToken("org_a", e)).toBe("verified");
  });

  it("still verifies an HMAC-signed edge after key rotation", () => {
    process.env.AUDIT_SIGNING_KEY = "old-secret";
    const e = edge("org_a");

    process.env.AUDIT_SIGNING_KEY = "new-secret";
    process.env.AUDIT_SIGNING_KEY_PREVIOUS = "old-secret";
    expect(verifyAttestationToken("org_a", e)).toBe("verified");
  });

  it("reports broken for an Ed25519 signature from a key that was never ours", () => {
    const attacker = keypair();
    const ours = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = attacker.privatePem;
    const e = edge("org_a");

    process.env.AUDIT_ED25519_PRIVATE_KEY = ours.privatePem;
    expect(verifyAttestationToken("org_a", e)).toBe("broken");
  });

  it("chains parent_token_hash from the signature value, not a raw token string", () => {
    process.env.AUDIT_ED25519_PRIVATE_KEY = keypair().privatePem;
    const parent = edge("org_a");
    const child = buildAttestationToken(
      "org_a", "run_child", "run_grandchild", "subagent", "leaf-agent", 2, ["*"],
      // Mirrors how deriveAndPersistChain/getTrustChain derive the link.
      createHash("sha256").update(parent.signature.value).digest("hex"),
    );
    expect(child.attestation_hash).toBeTruthy();
    expect(child.signature.value).not.toBe(parent.signature.value);
  });
});
