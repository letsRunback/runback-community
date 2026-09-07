/**
 * The Ed25519 public key that signs Runback audit records, served at a stable,
 * well-known URL.
 *
 * Why this endpoint exists
 * -----------------------
 * Signed records embed their own `manifest.signature.pubkey`, which makes each
 * record self-contained and offline-verifiable. But a signature only proves the
 * record was signed by *whoever holds the matching private key* — and if the
 * only copy of the public key comes from the record itself, an attacker can
 * doctor a record, re-sign it with their own keypair, swap in their own public
 * key, and it verifies perfectly.
 *
 * Pinning closes that. A verifier compares the embedded key against this
 * published one; only a match proves the record came from Runback. That is the
 * difference between "this file is internally consistent" and "this is the
 * record Runback produced", and it is the entire basis of the claim on /verify
 * that you do not have to trust us.
 *
 * Served as text/plain so `curl` and `openssl` can consume it directly, and
 * cached hard — the key rotates on the order of years, not deploys.
 */

export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * Read from env so the key is configured in one place (AUDIT_ED25519_PUBLIC_KEY,
 * or derived from the private key if only that is set). Returning 404 rather
 * than a placeholder matters: a verifier that fetches a bogus key and "fails to
 * match" is worse than one that can tell the key is not published yet.
 */
function publicKeyPem(): string | null {
  const explicit = process.env.AUDIT_ED25519_PUBLIC_KEY;
  if (explicit) return explicit.trim();

  const priv = process.env.AUDIT_ED25519_PRIVATE_KEY;
  if (!priv) return null;
  try {
    // Lazy import: keeps node:crypto out of any edge/client bundle graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPrivateKey, createPublicKey } = require("node:crypto");
    const pub = createPublicKey(createPrivateKey(priv));
    return (pub.export({ type: "spki", format: "pem" }) as string).trim();
  } catch (e) {
    console.error("[audit-key] could not derive public key from AUDIT_ED25519_PRIVATE_KEY:", e);
    return null;
  }
}

export async function GET() {
  const pem = publicKeyPem();

  if (!pem) {
    return new Response(
      "Ed25519 audit signing is not configured on this deployment.\n" +
        "Records here are signed with HMAC-SHA256, which cannot be verified without the shared secret.\n" +
        "See https://runback.dev/verify for what that means.\n",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  return new Response(pem + "\n", {
    headers: {
      "content-type": "application/x-pem-file; charset=utf-8",
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
