/**
 * @runback/verify's AI narrative check — the CLI-side counterpart to
 * web/lib/narrativesCore.ts. Same offline-verifiability argument as
 * ed25519.test.js's audit-record tests: a narrative signed by an attacker's
 * own keypair must NOT be indistinguishable from a genuine Runback-signed
 * one, and tampering with the sealed fields after the fact must be caught.
 */
import { describe, it, expect } from "vitest";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, createHmac, createHash } from "node:crypto";
import { verifyNarrative, verifyNarrativeJson } from "../index.js";

function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map((x) => canonical(x)).join(",") + "]";
  const parts = [];
  for (const k of Object.keys(v).sort()) parts.push(JSON.stringify(k) + ":" + canonical(v[k]));
  return "{" + parts.join(",") + "}";
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function newKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

const FIELDS = {
  org_id: "org-1",
  run_id: "run-1",
  subject: "model_diff",
  subject_ref: "gpt-4o:claude-sonnet-4-6:30",
  content_digest: "digest-abc",
  model_id: "groq/llama",
  prompt: { agentName: "loan-agent" },
  output: { narrative: "The agent now escalates instead of auto-approving." },
};

/** Build a fully-sealed narrative row exactly as web/lib/narratives.ts would. */
function buildRow(signPayload, overrides = {}) {
  const fields = { ...FIELDS, ...overrides };
  const prev_hash = overrides.prev_hash ?? "";
  const payload_hash = sha256(canonical({ ...fields, prev_hash }));
  const entry_hash = sha256(prev_hash + payload_hash);
  return { ...fields, prev_hash, payload_hash, entry_hash, signature: signPayload(entry_hash) };
}

function ed25519Signer(privateKeyPem) {
  return (entryHash) => {
    const key = createPrivateKey(privateKeyPem);
    return {
      alg: "Ed25519",
      value: cryptoSign(null, Buffer.from(entryHash, "utf8"), key).toString("hex"),
      pubkey: createPublicKey(key).export({ type: "spki", format: "pem" }),
    };
  };
}
function hmacSigner(key) {
  return (entryHash) => ({ alg: "HMAC-SHA256", value: createHmac("sha256", key).update(entryHash).digest("hex") });
}

describe("verifyNarrative — Ed25519", () => {
  it("verifies offline with no shared secret when the signer is pinned", () => {
    const { privatePem, publicPem } = newKeypair();
    const row = buildRow(ed25519Signer(privatePem));
    const res = verifyNarrative(row, undefined, { expectedPublicKey: publicPem });
    expect(res.checks.payload).toBe(true);
    expect(res.checks.chain).toBe(true);
    expect(res.checks.signature).toBe("valid");
    expect(res.valid).toBe(true);
  });

  it("reports valid-unpinned — not valid — when re-signed by an attacker's own key", () => {
    const attacker = newKeypair();
    const runback = newKeypair();
    const row = buildRow(ed25519Signer(attacker.privatePem));
    const res = verifyNarrative(row, undefined, { expectedPublicKey: runback.publicPem });
    expect(res.checks.signature).toBe("valid-unpinned");
    expect(res.valid).toBe(false);
  });
});

describe("verifyNarrative — HMAC-SHA256", () => {
  it("verifies against the correct key, fails against a wrong one", () => {
    const row = buildRow(hmacSigner("real-key"));
    expect(verifyNarrative(row, "real-key").valid).toBe(true);
    expect(verifyNarrative(row, "wrong-key").valid).toBe(false);
    expect(verifyNarrative(row, undefined).checks.signature).toBe("no-key");
  });
});

describe("verifyNarrative — tamper detection", () => {
  it("altering output after sealing breaks payload validity", () => {
    const row = buildRow(hmacSigner("k"));
    const tampered = { ...row, output: { narrative: "a rewritten, rosier version" } };
    const res = verifyNarrative(tampered, "k");
    expect(res.checks.payload).toBe(false);
    expect(res.valid).toBe(false);
  });

  it("altering prev_hash after sealing breaks the chain link", () => {
    const row = buildRow(hmacSigner("k"));
    const forked = { ...row, prev_hash: "a-different-prior-entry" };
    expect(verifyNarrative(forked, "k").checks.chain).toBe(false);
  });

  it("digest_matches: null with no comparison, true/false when a current digest is supplied", () => {
    const row = buildRow(hmacSigner("k"), { content_digest: "digest-at-generation" });
    expect(verifyNarrative(row, "k").checks.digest_matches).toBeNull();
    expect(verifyNarrative(row, "k", { currentContentDigest: "digest-at-generation" }).checks.digest_matches).toBe(true);
    const stale = verifyNarrative(row, "k", { currentContentDigest: "digest-after-alteration" });
    expect(stale.checks.digest_matches).toBe(false);
    expect(stale.valid).toBe(false);
  });
});

describe("verifyNarrativeJson", () => {
  it("throws a clear error on non-narrative JSON (e.g. an audit record)", () => {
    expect(() => verifyNarrativeJson(JSON.stringify({ $schema: "runback.audit/v2", manifest: {}, events: [] })))
      .toThrow(/Not a runback narrative row/);
  });

  it("round-trips a real row through JSON stringify/parse", () => {
    const row = buildRow(hmacSigner("k"));
    const res = verifyNarrativeJson(JSON.stringify(row), "k");
    expect(res.valid).toBe(true);
  });
});
