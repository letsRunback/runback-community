/**
 * Ed25519 signature verification — the offline-verifiability claim.
 *
 * The whole argument on /verify is that an auditor can check a Runback record
 * without trusting Runback. That only holds if:
 *
 *   1. an Ed25519-signed record verifies with no shared secret at all, and
 *   2. a record re-signed by someone else does NOT silently pass as genuine.
 *
 * (2) is the part that is easy to get wrong: the public key travels inside the
 * record, so verifying against it alone proves only self-consistency. These
 * tests pin that distinction down.
 */
import { describe, it, expect } from "vitest";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { createHmac } from "node:crypto";
import { verify, computeEventChain, computeCassetteDigest } from "../index.js";

const EVENTS = [
  { schema_version: 1, run_id: "rt-1", span_id: "r", seq: 0, type: "run", phase: "start", name: "roundtrip" },
  { schema_version: 1, run_id: "rt-1", span_id: "t1", seq: 1, type: "tool", tool_name: "echo", output: { ok: true } },
];

/** Build a record exactly the way web/lib/audit.ts does. */
function buildRecord(signer) {
  const { hashes, digest } = computeEventChain(EVENTS);
  const cassette = computeCassetteDigest(EVENTS);
  const payload = `${digest}:${cassette.digest}`;
  return {
    $schema: "runback.audit/v2",
    manifest: {
      run_id: "rt-1",
      content_digest: digest,
      replay: { cassette_digest: cassette.digest },
      signature: signer ? signer(payload) : null,
    },
    events: EVENTS.map((e, i) => ({ ...e, _hash: hashes[i] })),
  };
}

function ed25519Signer(privateKeyPem) {
  return (payload) => {
    const key = createPrivateKey(privateKeyPem);
    return {
      alg: "Ed25519",
      value: cryptoSign(null, Buffer.from(payload, "utf8"), key).toString("hex"),
      pubkey: createPublicKey(key).export({ type: "spki", format: "pem" }),
    };
  };
}

function newKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

describe("Ed25519 audit signatures", () => {
  it("verifies offline with no shared secret when the signer is pinned", () => {
    const { privatePem, publicPem } = newKeypair();
    const record = buildRecord(ed25519Signer(privatePem));

    const res = verify(record, undefined, { expectedPublicKey: publicPem });

    expect(res.checks.chain).toBe(true);
    expect(res.checks.digest).toBe(true);
    expect(res.checks.signature_alg).toBe("Ed25519");
    expect(res.checks.signature).toBe("valid");
    expect(res.valid).toBe(true);
  });

  it("reports valid-unpinned when the signer is not the expected key", () => {
    const attacker = newKeypair();
    const runback = newKeypair();
    // A doctored record re-signed with the attacker's own key: internally
    // consistent, cryptographically sound, and NOT from Runback.
    const record = buildRecord(ed25519Signer(attacker.privatePem));

    const res = verify(record, undefined, { expectedPublicKey: runback.publicPem });

    expect(res.checks.signature).toBe("valid-unpinned");
    expect(res.checks.signature).not.toBe("valid");
  });

  it("reports valid-unpinned, not valid, when there is no key to pin against", () => {
    const { privatePem } = newKeypair();
    const record = buildRecord(ed25519Signer(privatePem));

    const res = verify(record, undefined, { expectedPublicKey: null });

    expect(res.checks.signature).toBe("valid-unpinned");
  });

  it("rejects a tampered payload even though the signature is well-formed", () => {
    const { privatePem, publicPem } = newKeypair();
    const record = buildRecord(ed25519Signer(privatePem));
    record.manifest.replay.cassette_digest = "0".repeat(64);

    const res = verify(record, undefined, { expectedPublicKey: publicPem });

    expect(res.checks.cassette).toBe(false);
    expect(res.checks.signature).toBe("invalid");
    expect(res.valid).toBe(false);
  });

  it("verifies against a rotated-in key when pinned as an array (rotation)", () => {
    const oldKey = newKeypair();
    const newKey = newKeypair();
    // Record signed under the OLD key, before rotation.
    const record = buildRecord(ed25519Signer(oldKey.privatePem));

    // The deployment now pins BOTH keys, newest first — mirrors
    // RUNBACK_AUDIT_PUBKEYS_PEM after a rotation.
    const res = verify(record, undefined, { expectedPublicKey: [newKey.publicPem, oldKey.publicPem] });

    expect(res.checks.signature).toBe("valid");
    expect(res.valid).toBe(true);
  });

  it("reports revoked, not valid, for a signature from a compromised key — even if it would otherwise pin", () => {
    const compromised = newKeypair();
    const record = buildRecord(ed25519Signer(compromised.privatePem));

    const res = verify(record, undefined, {
      expectedPublicKey: compromised.publicPem, // would pin cleanly...
      revokedPublicKeys: [compromised.publicPem], // ...but it's been revoked
    });

    expect(res.checks.signature).toBe("revoked");
    expect(res.valid).toBe(false);
  });

  it("tolerates PEM whitespace differences when pinning", () => {
    const { privatePem, publicPem } = newKeypair();
    const record = buildRecord(ed25519Signer(privatePem));

    // Same key, re-wrapped — must not change the verdict.
    const reflowed = publicPem.replace(/\n/g, "\r\n") + "\n\n";
    const res = verify(record, undefined, { expectedPublicKey: reflowed });

    expect(res.checks.signature).toBe("valid");
  });
});

describe("HMAC records (legacy)", () => {
  const hmacSigner = (key) => (payload) => ({
    alg: "HMAC-SHA256",
    value: createHmac("sha256", key).update(payload).digest("hex"),
  });

  it("cannot be verified by a third party without the secret", () => {
    const record = buildRecord(hmacSigner("server-only-secret"));

    const res = verify(record); // an auditor, holding nothing

    expect(res.checks.signature_alg).toBe("HMAC-SHA256");
    expect(res.checks.signature).toBe("no-key");
  });

  it("verifies for someone who does hold the secret", () => {
    const record = buildRecord(hmacSigner("server-only-secret"));

    const res = verify(record, "server-only-secret");

    expect(res.checks.signature).toBe("valid");
    expect(res.valid).toBe(true);
  });

  it("detects a wrong secret", () => {
    const record = buildRecord(hmacSigner("server-only-secret"));

    const res = verify(record, "not-the-secret");

    expect(res.checks.signature).toBe("invalid");
    expect(res.valid).toBe(false);
  });
});
