/**
 * Shared signing primitives — the ONE place the algorithm choice lives.
 *
 * Preference order everywhere a record needs to be sealed: Ed25519
 * (asymmetric, non-repudiable, independently verifiable offline against a
 * published public key) with a fallback to HMAC-SHA256 (symmetric, proves
 * custody of a shared secret, not identity) when no keypair is configured.
 *
 * This was previously decided twice, and drifted twice: lib/audit.ts picked
 * Ed25519-first for the per-run audit record; lib/trust.ts independently
 * picked HMAC-only, and per-org-derived at that, for inter-agent delegation
 * attestations — so the flagship "signed, independently verifiable" claim on
 * /enterprise was true for one artifact and false for the other, and every
 * fix to one didn't propagate to the other. Both now import sign() and
 * ourEd25519PublicKeys() from here instead of each rolling its own — a
 * second divergence would have to happen in this one file, not silently
 * across two.
 *
 * Generate an Ed25519 key pair (set both env vars):
 *   openssl genpkey -algorithm ed25519 -outform PEM | tee audit_private.pem
 *   openssl pkey -in audit_private.pem -pubout | tee audit_public.pem
 *   AUDIT_ED25519_PRIVATE_KEY="$(cat audit_private.pem)"
 *   AUDIT_ED25519_PUBLIC_KEY="$(cat audit_public.pem)"   # optional — derived at verify time
 *
 * Rotating the Ed25519 key: set AUDIT_ED25519_PRIVATE_KEY (and optionally
 * _PUBLIC_KEY) to the new pair, and move the outgoing values to
 * AUDIT_ED25519_PRIVATE_KEY_PREVIOUS / _PUBLIC_KEY_PREVIOUS. New records sign
 * with the new key only; verification still accepts records signed under the
 * previous one. Drop the _PREVIOUS vars once nothing you still care about
 * verifying was signed under the old key. The same rotation story now covers
 * every artifact this module signs — audit records and trust attestations
 * alike — instead of each having its own rotation guard (or, as trust
 * attestations had, none).
 */
import { createHmac, createPrivateKey, createPublicKey, timingSafeEqual, sign as cryptoSign, verify as cryptoVerify } from "crypto";

export interface Signature {
  alg: "HMAC-SHA256" | "Ed25519";
  value: string;     // hex-encoded signature
  pubkey?: string;    // PEM public key (Ed25519 only) — embedded for offline verification
}

/** Derive an SPKI PEM public key from either an explicit public-key env var or a private-key one. */
function derivePublicKeyPem(explicitVar: string | undefined, privateVar: string | undefined): string | null {
  if (explicitVar) return explicitVar.trim();
  if (!privateVar) return null;
  try {
    return (createPublicKey(createPrivateKey(privateVar)).export({ type: "spki", format: "pem" }) as string).trim();
  } catch {
    return null;
  }
}

/**
 * This deployment's own Ed25519 public key(s), in SPKI PEM, newest first —
 * empty if it signs with HMAC. Anything this deployment signs (audit
 * records, trust attestations) is pinned against this same list, so a
 * record's "valid" verdict means the same thing regardless of which
 * artifact it is.
 */
export function ourEd25519PublicKeys(): string[] {
  const keys = [
    derivePublicKeyPem(process.env.AUDIT_ED25519_PUBLIC_KEY, process.env.AUDIT_ED25519_PRIVATE_KEY),
    derivePublicKeyPem(process.env.AUDIT_ED25519_PUBLIC_KEY_PREVIOUS, process.env.AUDIT_ED25519_PRIVATE_KEY_PREVIOUS),
  ].filter((k): k is string => !!k);
  return [...new Set(keys)];
}

/** Sign a payload string. Ed25519 if AUDIT_ED25519_PRIVATE_KEY is set, else HMAC-SHA256 via AUDIT_SIGNING_KEY, else null (unsigned). */
export function sign(payload: string): Signature | null {
  const ed25519Pem = process.env.AUDIT_ED25519_PRIVATE_KEY;
  if (ed25519Pem) {
    try {
      const privateKey = createPrivateKey(ed25519Pem);
      const sigBuf = cryptoSign(null, Buffer.from(payload, "utf8"), privateKey);
      const publicKey = createPublicKey(privateKey);
      const pubkeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
      return { alg: "Ed25519", value: sigBuf.toString("hex"), pubkey: pubkeyPem };
    } catch (e) {
      console.error("[signing] Ed25519 sign failed — falling back to HMAC:", e);
    }
  }
  const hmacKey = process.env.AUDIT_SIGNING_KEY;
  if (!hmacKey) return null;
  return { alg: "HMAC-SHA256", value: createHmac("sha256", hmacKey).update(payload).digest("hex") };
}

export type SignatureVerdict = "valid" | "valid-unpinned" | "invalid" | "no-key";

/**
 * Verify a payload against a signature.
 *  - Ed25519: checks the signature against its embedded pubkey, then checks
 *    that pubkey is one of ours ("valid") or unrecognised ("valid-unpinned"
 *    — cryptographically sound, but the signer isn't this deployment; the
 *    honest answer for e.g. a self-hosted record pasted into the hosted
 *    verifier, not a pass).
 *  - HMAC-SHA256: recomputed against every key in `hmacKeys` (pass the
 *    current + previous rotation set), constant-time compared. No unpinned
 *    state exists for a symmetric key — it's "valid" or "invalid".
 */
export function verifySignature(payload: string, sig: Signature, hmacKeys: string[]): SignatureVerdict {
  if (sig.alg === "Ed25519") {
    if (!sig.pubkey) return "no-key";
    try {
      const pubKey = createPublicKey(sig.pubkey);
      const ok = cryptoVerify(null, Buffer.from(payload, "utf8"), pubKey, Buffer.from(sig.value, "hex"));
      if (!ok) return "invalid";
      const pinned = ourEd25519PublicKeys();
      if (pinned.length === 0) return "valid-unpinned";
      // Compare normalised DER, never raw PEM text — line wrapping and
      // trailing whitespace differ between exporters and must not change
      // the verdict.
      const embedded = createPublicKey(sig.pubkey).export({ type: "spki", format: "der" }) as Buffer;
      const matches = pinned.some((p) => {
        const b = createPublicKey(p).export({ type: "spki", format: "der" }) as Buffer;
        return embedded.length === b.length && timingSafeEqual(embedded, b);
      });
      return matches ? "valid" : "valid-unpinned";
    } catch {
      return "invalid";
    }
  }
  // HMAC-SHA256 — checked against every accepted key (current + previous),
  // not just the newest, so a rotation doesn't retroactively invalidate
  // something signed a day earlier.
  if (!hmacKeys.length) return "no-key";
  const provided = Buffer.from(sig.value);
  let matched = false;
  for (const key of hmacKeys) {
    const expected = Buffer.from(createHmac("sha256", key).update(payload).digest("hex"));
    // No early exit — never branch on signature bytes, nor leak which key matched.
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) matched = true;
  }
  return matched ? "valid" : "invalid";
}
