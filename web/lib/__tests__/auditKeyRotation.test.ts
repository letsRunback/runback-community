/**
 * AUDIT_SIGNING_KEY rotation.
 *
 * Two things signed with this key are PERSISTED and verified later by
 * recomputing the HMAC:
 *
 *   - ad_ledger_checkpoints.signature — the seal over the org's chain head and
 *     Merkle root, i.e. the tamper-evidence anchor for the whole ledger.
 *   - audit records a customer has already downloaded and filed as evidence.
 *
 * Rotating the key without a key-ring silently invalidates both. Because ledger
 * verification is fail-closed, an entirely intact ledger would start reporting
 * as tampered — the alarm firing precisely when nothing is wrong, in the one
 * product where that claim is the product.
 *
 * These tests pin the asymmetry that makes rotation safe: sign with the newest
 * key, verify against every key we have plausibly used.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  auditHmacKeys,
  signCheckpoint,
  verifyCheckpointSignature,
} from "@/lib/ledgerCore";

const OLD = "the-key-in-use-before-the-rotation";
const NEW = "the-freshly-rotated-key";

const ORG = "11111111-2222-3333-4444-555555555555";
const SEQ = 22;
const HEAD = "a".repeat(64);
const ROOT = "b".repeat(64);

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
beforeEach(() => {
  delete process.env.AUDIT_SIGNING_KEY;
  delete process.env.AUDIT_SIGNING_KEY_PREVIOUS;
});

describe("audit HMAC key ring", () => {
  it("signs with the current key only", () => {
    process.env.AUDIT_SIGNING_KEY = NEW;
    process.env.AUDIT_SIGNING_KEY_PREVIOUS = OLD;

    const sig = signCheckpoint(ORG, SEQ, HEAD, ROOT)!;
    const expectedNew = crypto
      .createHmac("sha256", NEW)
      .update(`ledger:${ORG}:${SEQ}:${HEAD}:${ROOT}`)
      .digest("hex");

    expect(sig).toBe(expectedNew);
  });

  it("still verifies a checkpoint sealed BEFORE the rotation", () => {
    // Sealed while OLD was the only key…
    process.env.AUDIT_SIGNING_KEY = OLD;
    const sealedBefore = signCheckpoint(ORG, SEQ, HEAD, ROOT)!;

    // …then the key is rotated, old value retained as the previous key.
    process.env.AUDIT_SIGNING_KEY = NEW;
    process.env.AUDIT_SIGNING_KEY_PREVIOUS = OLD;

    expect(verifyCheckpointSignature(ORG, SEQ, HEAD, ROOT, sealedBefore)).toBe(true);
  });

  it("verifies a checkpoint sealed AFTER the rotation", () => {
    process.env.AUDIT_SIGNING_KEY = NEW;
    process.env.AUDIT_SIGNING_KEY_PREVIOUS = OLD;

    const sig = signCheckpoint(ORG, SEQ, HEAD, ROOT)!;
    expect(verifyCheckpointSignature(ORG, SEQ, HEAD, ROOT, sig)).toBe(true);
  });

  it("would have reported the pre-rotation checkpoint as INVALID without the ring", () => {
    // This is the regression the key ring exists to prevent — asserted directly
    // so nobody "simplifies" verifyCheckpointSignature back to one key.
    process.env.AUDIT_SIGNING_KEY = OLD;
    const sealedBefore = signCheckpoint(ORG, SEQ, HEAD, ROOT)!;

    process.env.AUDIT_SIGNING_KEY = NEW;
    delete process.env.AUDIT_SIGNING_KEY_PREVIOUS; // no ring

    expect(verifyCheckpointSignature(ORG, SEQ, HEAD, ROOT, sealedBefore)).toBe(false);
  });

  it("rejects a signature from a key that was never ours", () => {
    process.env.AUDIT_SIGNING_KEY = NEW;
    process.env.AUDIT_SIGNING_KEY_PREVIOUS = OLD;

    const forged = crypto
      .createHmac("sha256", "attacker-key")
      .update(`ledger:${ORG}:${SEQ}:${HEAD}:${ROOT}`)
      .digest("hex");

    expect(verifyCheckpointSignature(ORG, SEQ, HEAD, ROOT, forged)).toBe(false);
  });

  it("rejects a valid signature over DIFFERENT content", () => {
    process.env.AUDIT_SIGNING_KEY = NEW;
    const sig = signCheckpoint(ORG, SEQ, HEAD, ROOT)!;

    // Same key, but the ledger head moved — must not verify.
    expect(verifyCheckpointSignature(ORG, SEQ, "c".repeat(64), ROOT, sig)).toBe(false);
    expect(verifyCheckpointSignature(ORG, SEQ + 1, HEAD, ROOT, sig)).toBe(false);
    expect(verifyCheckpointSignature("other-org", SEQ, HEAD, ROOT, sig)).toBe(false);
  });

  it("fails closed with no key configured", () => {
    expect(auditHmacKeys()).toEqual([]);
    expect(signCheckpoint(ORG, SEQ, HEAD, ROOT)).toBeNull();
    expect(verifyCheckpointSignature(ORG, SEQ, HEAD, ROOT, "d".repeat(64))).toBe(false);
  });

  it("treats a null signature as unverified, not as a pass", () => {
    process.env.AUDIT_SIGNING_KEY = NEW;
    expect(verifyCheckpointSignature(ORG, SEQ, HEAD, ROOT, null)).toBe(false);
  });

  it("deduplicates when previous and current hold the same value", () => {
    process.env.AUDIT_SIGNING_KEY = NEW;
    process.env.AUDIT_SIGNING_KEY_PREVIOUS = NEW;
    expect(auditHmacKeys()).toEqual([NEW]);
  });
});
