/**
 * Unsubscribe link signing.
 *
 * The signature over the recipient's address IS the credential — these links
 * must work for a logged-out recipient, so nothing else authenticates them.
 * Required by EU ePrivacy / UK PECR, which is why the routes hard-fail rather
 * than fall open when no key is configured.
 *
 * Why signing and verification are asymmetric
 * -------------------------------------------
 * Links live in people's mailboxes indefinitely. A link mailed last month was
 * signed with whatever key was configured then, and it has to keep working —
 * an unsubscribe link that silently stops verifying is an opt-out you failed to
 * honour, not a minor regression.
 *
 * So: sign with ONE key (the newest), verify against ALL keys we have ever
 * plausibly used. `AUDIT_SIGNING_KEY` was the fallback signer before a dedicated
 * `UNSUBSCRIBE_SECRET` existed, so it stays a valid verifier — and only a
 * verifier. Once no in-flight mail predates the dedicated secret, drop it from
 * `verifyKeys()`.
 */
import crypto from "crypto";

/** The key new links are signed with. */
export function signingKey(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || process.env.AUDIT_SIGNING_KEY || null;
}

/**
 * Every key a link in the wild might legitimately carry, newest first.
 * Deduplicated so the common single-key deployment does one comparison.
 */
export function verifyKeys(): string[] {
  const keys = [process.env.UNSUBSCRIBE_SECRET, process.env.AUDIT_SIGNING_KEY]
    .filter((k): k is string => !!k);
  return [...new Set(keys)];
}

/**
 * The signed payload. The newsletter signs the bare address; PLG nurture mail
 * prefixes `plg_unsub:` so a token for one list can never be replayed against
 * the other. Both are represented here so the two routes cannot drift.
 */
export type UnsubKind = "newsletter" | "plg";

function payload(email: string, kind: UnsubKind): string {
  const addr = email.toLowerCase();
  return kind === "plg" ? `plg_unsub:${addr}` : addr;
}

export function signUnsubscribe(email: string, key: string, kind: UnsubKind = "newsletter"): string {
  return crypto.createHmac("sha256", key).update(payload(email, kind)).digest("hex");
}

/**
 * Constant-time verification against each accepted key.
 *
 * Every candidate is checked even after a match so the work done does not depend
 * on which key matched — the loop must not short-circuit into a timing signal
 * about key rotation.
 */
export function verifyUnsubscribe(email: string, sig: string, kind: UnsubKind = "newsletter"): boolean {
  const keys = verifyKeys();
  if (!keys.length || !sig) return false;

  let ok = false;
  for (const key of keys) {
    const expected = signUnsubscribe(email, key, kind);
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(sig, "hex");
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) ok = true;
    } catch {
      // Malformed hex in the query string — not a match, not an error.
    }
  }
  return ok;
}
