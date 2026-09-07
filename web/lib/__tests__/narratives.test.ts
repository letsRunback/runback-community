/**
 * AI narrative sealing (web/lib/narrativesCore.ts) — the pure hash-chain/
 * signing primitives behind "verifiable AI root-cause narration." Same
 * signing module as trust.ts attestations and the per-run audit record
 * (lib/signing.ts), same test-env-isolation convention as
 * trustAttestation.test.ts, so these primitives are pinned the same way.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import {
  narrativePayloadHash,
  narrativeEntryHash,
  buildNarrativeChainLink,
  verifyNarrative,
  type NarrativePayloadInput,
} from "@/lib/narrativesCore";

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

function payload(overrides: Partial<NarrativePayloadInput> = {}): NarrativePayloadInput {
  return {
    org_id: "org-1",
    run_id: "run-1",
    subject: "model_diff",
    subject_ref: "gpt-4o:claude-sonnet-4-6:30",
    content_digest: "digest-abc",
    model_id: "groq/llama",
    prompt: { agentName: "loan-agent" },
    output: { narrative: "The agent now escalates instead of auto-approving." },
    prev_hash: "",
    ...overrides,
  };
}

describe("narrative payload/chain hashing — deterministic, tamper-evident", () => {
  it("the same input always produces the same payload_hash", () => {
    expect(narrativePayloadHash(payload())).toBe(narrativePayloadHash(payload()));
  });

  it("changing ANY field changes the payload_hash", () => {
    const base = narrativePayloadHash(payload());
    expect(narrativePayloadHash(payload({ run_id: "run-2" }))).not.toBe(base);
    expect(narrativePayloadHash(payload({ content_digest: "digest-xyz" }))).not.toBe(base);
    expect(narrativePayloadHash(payload({ output: { narrative: "different text" } }))).not.toBe(base);
    expect(narrativePayloadHash(payload({ prev_hash: "some-prior-hash" }))).not.toBe(base);
  });

  it("entry_hash chains prev_hash into the payload — reordering breaks it", () => {
    const h1 = narrativePayloadHash(payload());
    const entryA = narrativeEntryHash("", h1);
    const entryB = narrativeEntryHash("some-other-prev", h1);
    expect(entryA).not.toBe(entryB);
  });
});

describe("buildNarrativeChainLink — signing", () => {
  it("throws when no signing key is configured (never silently ship an unsigned narrative)", () => {
    expect(() => buildNarrativeChainLink(payload())).toThrow(/cannot sign narratives/);
  });

  it("signs with Ed25519 when a keypair is configured", () => {
    const { privatePem } = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = privatePem;
    const link = buildNarrativeChainLink(payload());
    expect(link.signature.alg).toBe("Ed25519");
    expect(link.signature.pubkey).toBeTruthy();
  });

  it("falls back to HMAC-SHA256 when only AUDIT_SIGNING_KEY is set", () => {
    process.env.AUDIT_SIGNING_KEY = "test-hmac-key";
    const link = buildNarrativeChainLink(payload());
    expect(link.signature.alg).toBe("HMAC-SHA256");
  });
});

describe("verifyNarrative — round trip + tamper detection", () => {
  it("a freshly sealed narrative verifies as valid (Ed25519, pinned)", () => {
    const { privatePem, publicPem } = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = privatePem;
    process.env.AUDIT_ED25519_PUBLIC_KEY = publicPem;
    const p = payload();
    const link = buildNarrativeChainLink(p);
    const verdict = verifyNarrative(
      { ...p, payload_hash: link.payload_hash, entry_hash: link.entry_hash, signature: link.signature },
      []
    );
    expect(verdict.verified).toBe(true);
    expect(verdict.signatureVerdict).toBe("valid");
  });

  it("HMAC round trip verifies against the same key, fails against a different one", () => {
    process.env.AUDIT_SIGNING_KEY = "real-key";
    const p = payload();
    const link = buildNarrativeChainLink(p);
    const row = { ...p, payload_hash: link.payload_hash, entry_hash: link.entry_hash, signature: link.signature };
    expect(verifyNarrative(row, ["real-key"]).verified).toBe(true);
    expect(verifyNarrative(row, ["wrong-key"]).verified).toBe(false);
  });

  it("altering the sealed output AFTER the fact breaks payload validity (tamper detected)", () => {
    process.env.AUDIT_SIGNING_KEY = "k";
    const p = payload();
    const link = buildNarrativeChainLink(p);
    const tampered = {
      ...p,
      output: { narrative: "a rosier, edited version of what happened" },
      payload_hash: link.payload_hash, // stale — doesn't match the tampered output
      entry_hash: link.entry_hash,
      signature: link.signature,
    };
    const verdict = verifyNarrative(tampered, ["k"]);
    expect(verdict.payloadValid).toBe(false);
    expect(verdict.verified).toBe(false);
  });

  it("altering prev_hash after sealing breaks the chain link (fork detection)", () => {
    process.env.AUDIT_SIGNING_KEY = "k";
    const p = payload();
    const link = buildNarrativeChainLink(p);
    const forked = {
      ...p,
      payload_hash: link.payload_hash,
      entry_hash: link.entry_hash, // stale — was computed against the ORIGINAL prev_hash
      prev_hash: "a-different-prior-entry",
      signature: link.signature,
    };
    expect(verifyNarrative(forked, ["k"]).chainValid).toBe(false);
  });

  it("digest_matches is null when no current digest is supplied, and false when the run has since changed", () => {
    process.env.AUDIT_SIGNING_KEY = "k";
    const p = payload({ content_digest: "digest-at-generation-time" });
    const link = buildNarrativeChainLink(p);
    const row = { ...p, payload_hash: link.payload_hash, entry_hash: link.entry_hash, signature: link.signature };

    expect(verifyNarrative(row, ["k"]).digestMatches).toBeNull();
    expect(verifyNarrative(row, ["k"], "digest-at-generation-time").digestMatches).toBe(true);
    expect(verifyNarrative(row, ["k"], "digest-after-the-run-was-altered").digestMatches).toBe(false);
    expect(verifyNarrative(row, ["k"], "digest-after-the-run-was-altered").verified).toBe(false);
  });
});
