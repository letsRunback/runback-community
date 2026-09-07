/**
 * Unsubscribe link signing across a key rotation.
 *
 * Setting a dedicated UNSUBSCRIBE_SECRET on a deployment that had been signing
 * with the AUDIT_SIGNING_KEY fallback changes which key new links use. Every
 * link already sitting in a subscriber's mailbox was signed with the old one —
 * and an unsubscribe link that stops verifying is an opt-out you failed to
 * honour, which is a PECR/ePrivacy problem, not a cosmetic one.
 *
 * These tests pin the asymmetry that makes the rotation safe: sign with one key,
 * verify against all of them.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  signingKey,
  verifyKeys,
  signUnsubscribe,
  verifyUnsubscribe,
} from "@/lib/unsubscribeToken";

const OLD = "audit-signing-key-from-before-the-rotation";
const NEW = "dedicated-unsubscribe-secret";
const EMAIL = "Someone@Example.com";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
beforeEach(() => {
  delete process.env.UNSUBSCRIBE_SECRET;
  delete process.env.AUDIT_SIGNING_KEY;
});

describe("unsubscribe key rotation", () => {
  it("signs with the dedicated secret once it exists", () => {
    process.env.AUDIT_SIGNING_KEY = OLD;
    process.env.UNSUBSCRIBE_SECRET = NEW;
    expect(signingKey()).toBe(NEW);
  });

  it("falls back to the audit key when no dedicated secret is set", () => {
    process.env.AUDIT_SIGNING_KEY = OLD;
    expect(signingKey()).toBe(OLD);
  });

  it("still honours a link signed with the OLD key after rotation", () => {
    // Link was mailed before the rotation…
    process.env.AUDIT_SIGNING_KEY = OLD;
    const oldLinkSig = signUnsubscribe(EMAIL, signingKey()!);

    // …then the dedicated secret is introduced.
    process.env.UNSUBSCRIBE_SECRET = NEW;

    expect(verifyUnsubscribe(EMAIL, oldLinkSig)).toBe(true);
  });

  it("honours a link signed with the new key too", () => {
    process.env.AUDIT_SIGNING_KEY = OLD;
    process.env.UNSUBSCRIBE_SECRET = NEW;
    const sig = signUnsubscribe(EMAIL, signingKey()!);
    expect(verifyUnsubscribe(EMAIL, sig)).toBe(true);
  });

  it("rejects a signature from a key that was never ours", () => {
    process.env.AUDIT_SIGNING_KEY = OLD;
    process.env.UNSUBSCRIBE_SECRET = NEW;
    expect(verifyUnsubscribe(EMAIL, signUnsubscribe(EMAIL, "attacker-key"))).toBe(false);
  });

  it("is case-insensitive on the address, so mail-client casing cannot break a link", () => {
    process.env.UNSUBSCRIBE_SECRET = NEW;
    const sig = signUnsubscribe("someone@example.com", NEW);
    expect(verifyUnsubscribe("SOMEONE@EXAMPLE.COM", sig)).toBe(true);
  });

  it("refuses everything when no key is configured (fail closed)", () => {
    expect(verifyKeys()).toEqual([]);
    expect(verifyUnsubscribe(EMAIL, "a".repeat(64))).toBe(false);
    expect(signingKey()).toBeNull();
  });

  it("does not let a newsletter token unsubscribe from PLG mail, or vice versa", () => {
    process.env.UNSUBSCRIBE_SECRET = NEW;
    const newsletterSig = signUnsubscribe(EMAIL, NEW, "newsletter");
    const plgSig = signUnsubscribe(EMAIL, NEW, "plg");

    expect(newsletterSig).not.toBe(plgSig);
    expect(verifyUnsubscribe(EMAIL, newsletterSig, "plg")).toBe(false);
    expect(verifyUnsubscribe(EMAIL, plgSig, "newsletter")).toBe(false);
    expect(verifyUnsubscribe(EMAIL, plgSig, "plg")).toBe(true);
  });

  it("treats malformed hex as a non-match rather than throwing", () => {
    process.env.UNSUBSCRIBE_SECRET = NEW;
    expect(verifyUnsubscribe(EMAIL, "not-hex-at-all")).toBe(false);
    expect(verifyUnsubscribe(EMAIL, "")).toBe(false);
  });

  it("deduplicates when both env vars hold the same value", () => {
    process.env.AUDIT_SIGNING_KEY = NEW;
    process.env.UNSUBSCRIBE_SECRET = NEW;
    expect(verifyKeys()).toEqual([NEW]);
  });
});
