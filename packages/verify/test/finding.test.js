/**
 * @runback/verify's external security-finding check — the CLI-side
 * counterpart to web/lib/securityFindingsCore.ts. Same offline-verifiability
 * argument as narrative.test.js: a finding signed by an attacker's own
 * keypair must NOT be indistinguishable from a genuine Runback-signed one,
 * and tampering with the sealed fields after the fact must be caught.
 */
import { describe, it, expect } from "vitest";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, createHmac, createHash } from "node:crypto";
import { verifyFinding, verifyFindingJson } from "../index.js";

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
  span_id: null,
  vendor: "lakera",
  rule: "prompt-injection-detected",
  severity: "high",
  verdict: "flagged",
  detail: "Detected an embedded instruction attempting to override the system prompt.",
  raw_finding: { score: 0.94, category: "injection" },
};

/** Build a fully-sealed finding row exactly as web/lib/securityFindings.ts would. */
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

describe("verifyFinding — Ed25519", () => {
  it("verifies offline with no shared secret when the signer is pinned", () => {
    const { privatePem, publicPem } = newKeypair();
    const row = buildRow(ed25519Signer(privatePem));
    const res = verifyFinding(row, undefined, { expectedPublicKey: publicPem });
    expect(res.checks.payload).toBe(true);
    expect(res.checks.chain).toBe(true);
    expect(res.checks.signature).toBe("valid");
    expect(res.valid).toBe(true);
  });

  it("reports valid-unpinned — not valid — when re-signed by an attacker's own key", () => {
    const attacker = newKeypair();
    const runback = newKeypair();
    const row = buildRow(ed25519Signer(attacker.privatePem));
    const res = verifyFinding(row, undefined, { expectedPublicKey: runback.publicPem });
    expect(res.checks.signature).toBe("valid-unpinned");
    expect(res.valid).toBe(false);
  });
});

describe("verifyFinding — HMAC-SHA256", () => {
  it("verifies against the correct key, fails against a wrong one", () => {
    const row = buildRow(hmacSigner("real-key"));
    expect(verifyFinding(row, "real-key").valid).toBe(true);
    expect(verifyFinding(row, "wrong-key").valid).toBe(false);
    expect(verifyFinding(row, undefined).checks.signature).toBe("no-key");
  });
});

describe("verifyFinding — tamper detection", () => {
  it("altering raw_finding after sealing breaks payload validity", () => {
    const row = buildRow(hmacSigner("k"));
    const tampered = { ...row, raw_finding: { score: 0.01, category: "benign" } };
    const res = verifyFinding(tampered, "k");
    expect(res.checks.payload).toBe(false);
    expect(res.valid).toBe(false);
  });

  it("softening severity after sealing breaks payload validity", () => {
    const row = buildRow(hmacSigner("k"), { severity: "critical" });
    const softened = { ...row, severity: "info" };
    expect(verifyFinding(softened, "k").checks.payload).toBe(false);
  });

  it("altering prev_hash after sealing breaks the chain link", () => {
    const row = buildRow(hmacSigner("k"));
    const forked = { ...row, prev_hash: "a-different-prior-entry" };
    expect(verifyFinding(forked, "k").checks.chain).toBe(false);
  });
});

describe("verifyFindingJson", () => {
  it("throws a clear error on non-finding JSON (e.g. a narrative row)", () => {
    expect(() =>
      verifyFindingJson(JSON.stringify({ org_id: "o", run_id: "r", subject: "model_diff", payload_hash: "x", prev_hash: "", entry_hash: "y", signature: {} }))
    ).toThrow(/Not a runback security-finding row/);
  });

  it("round-trips a real row through JSON stringify/parse", () => {
    const row = buildRow(hmacSigner("k"));
    const res = verifyFindingJson(JSON.stringify(row), "k");
    expect(res.valid).toBe(true);
  });
});
