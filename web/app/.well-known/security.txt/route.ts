/**
 * RFC 9116 security.txt.
 *
 * /security advertises security@runback.dev with a two-business-day
 * acknowledgement SLA, but /.well-known/security.txt returned 404 — which is
 * the file automated scanners and most researchers check first. Publishing the
 * contact only in prose means a finding reaches us through whatever channel the
 * finder improvises, or not at all.
 *
 * Served from a route rather than a static file so Expires stays correct
 * without anyone remembering to edit it: RFC 9116 requires the field, and a
 * stale one is treated as an invalid file.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // RFC 9116 §2.5.5 — must be in the future, and should not be far out. One
  // year, recomputed per request, so it can never lapse.
  const expires = new Date(Date.now() + 365 * 86400_000).toISOString();

  const body = [
    "Contact: mailto:security@runback.dev",
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    "Canonical: https://runback.dev/.well-known/security.txt",
    "Policy: https://runback.dev/security",
    "",
    "# We acknowledge reports within two business days and credit reporters",
    "# once a fix ships. Please do not run automated scanning against the",
    "# hosted service; if you need to test at volume, self-host — it is free,",
    "# and the whole stack runs locally with docker compose.",
    "",
    "# Runback's audit-signing public key, for verifying exported records:",
    "# https://runback.dev/.well-known/runback-audit-key.pem",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
