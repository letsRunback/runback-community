/**
 * External security-finding sealing (web/lib/securityFindingsCore.ts) — the
 * pure hash-chain/signing primitives behind "sealed guardrail-vendor
 * findings." Same test-env-isolation convention as narratives.test.ts, since
 * this module deliberately mirrors narrativesCore.ts's discipline.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import {
  findingPayloadHash,
  findingEntryHash,
  buildFindingChainLink,
  verifyFinding,
  type FindingPayloadInput,
} from "@/lib/securityFindingsCore";

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

function payload(overrides: Partial<FindingPayloadInput> = {}): FindingPayloadInput {
  return {
    org_id: "org-1",
    run_id: "run-1",
    span_id: null,
    vendor: "lakera",
    rule: "prompt-injection-detected",
    severity: "high",
    verdict: "flagged",
    detail: "Detected an embedded instruction attempting to override the system prompt.",
    raw_finding: { score: 0.94, category: "injection" },
    prev_hash: "",
    ...overrides,
  };
}

describe("finding payload/chain hashing — deterministic, tamper-evident", () => {
  it("the same input always produces the same payload_hash", () => {
    expect(findingPayloadHash(payload())).toBe(findingPayloadHash(payload()));
  });

  it("changing ANY field changes the payload_hash", () => {
    const base = findingPayloadHash(payload());
    expect(findingPayloadHash(payload({ run_id: "run-2" }))).not.toBe(base);
    expect(findingPayloadHash(payload({ vendor: "cisco-ai-defense" }))).not.toBe(base);
    expect(findingPayloadHash(payload({ severity: "critical" }))).not.toBe(base);
    expect(findingPayloadHash(payload({ verdict: "blocked" }))).not.toBe(base);
    expect(findingPayloadHash(payload({ raw_finding: { score: 0.1 } }))).not.toBe(base);
    expect(findingPayloadHash(payload({ prev_hash: "some-prior-hash" }))).not.toBe(base);
  });

  it("entry_hash chains prev_hash into the payload — reordering breaks it", () => {
    const h1 = findingPayloadHash(payload());
    const entryA = findingEntryHash("", h1);
    const entryB = findingEntryHash("some-other-prev", h1);
    expect(entryA).not.toBe(entryB);
  });
});

describe("buildFindingChainLink — signing", () => {
  it("throws when no signing key is configured (never silently ship an unsigned finding)", () => {
    expect(() => buildFindingChainLink(payload())).toThrow(/cannot sign findings/);
  });

  it("signs with Ed25519 when a keypair is configured", () => {
    const { privatePem } = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = privatePem;
    const link = buildFindingChainLink(payload());
    expect(link.signature.alg).toBe("Ed25519");
    expect(link.signature.pubkey).toBeTruthy();
  });

  it("falls back to HMAC-SHA256 when only AUDIT_SIGNING_KEY is set", () => {
    process.env.AUDIT_SIGNING_KEY = "test-hmac-key";
    const link = buildFindingChainLink(payload());
    expect(link.signature.alg).toBe("HMAC-SHA256");
  });
});

describe("verifyFinding — round trip + tamper detection", () => {
  it("a freshly sealed finding verifies as valid (Ed25519, pinned)", () => {
    const { privatePem, publicPem } = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = privatePem;
    process.env.AUDIT_ED25519_PUBLIC_KEY = publicPem;
    const p = payload();
    const link = buildFindingChainLink(p);
    const verdict = verifyFinding(
      { ...p, payload_hash: link.payload_hash, entry_hash: link.entry_hash, signature: link.signature },
      []
    );
    expect(verdict.verified).toBe(true);
    expect(verdict.signatureVerdict).toBe("valid");
  });

  it("HMAC round trip verifies against the same key, fails against a different one", () => {
    process.env.AUDIT_SIGNING_KEY = "real-key";
    const p = payload();
    const link = buildFindingChainLink(p);
    const row = { ...p, payload_hash: link.payload_hash, entry_hash: link.entry_hash, signature: link.signature };
    expect(verifyFinding(row, ["real-key"]).verified).toBe(true);
    expect(verifyFinding(row, ["wrong-key"]).verified).toBe(false);
  });

  it("altering the raw_finding AFTER the fact breaks payload validity (tamper detected)", () => {
    process.env.AUDIT_SIGNING_KEY = "k";
    const p = payload();
    const link = buildFindingChainLink(p);
    const tampered = {
      ...p,
      raw_finding: { score: 0.01, category: "benign" }, // softened after the fact
      payload_hash: link.payload_hash, // stale — doesn't match the tampered raw_finding
      entry_hash: link.entry_hash,
      signature: link.signature,
    };
    const verdict = verifyFinding(tampered, ["k"]);
    expect(verdict.payloadValid).toBe(false);
    expect(verdict.verified).toBe(false);
  });

  it("altering severity/verdict after sealing breaks payload validity", () => {
    process.env.AUDIT_SIGNING_KEY = "k";
    const p = payload({ severity: "critical", verdict: "blocked" });
    const link = buildFindingChainLink(p);
    const softened = {
      ...p,
      severity: "info" as const,
      payload_hash: link.payload_hash,
      entry_hash: link.entry_hash,
      signature: link.signature,
    };
    expect(verifyFinding(softened, ["k"]).verified).toBe(false);
  });

  it("altering prev_hash after sealing breaks the chain link (fork detection)", () => {
    process.env.AUDIT_SIGNING_KEY = "k";
    const p = payload();
    const link = buildFindingChainLink(p);
    const forked = {
      ...p,
      payload_hash: link.payload_hash,
      entry_hash: link.entry_hash, // stale — was computed against the ORIGINAL prev_hash
      prev_hash: "a-different-prior-entry",
      signature: link.signature,
    };
    expect(verifyFinding(forked, ["k"]).chainValid).toBe(false);
  });
});
