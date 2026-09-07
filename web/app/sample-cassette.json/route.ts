import { demoAuditRecord } from "@/lib/demoAuditRecord";

export const runtime = "nodejs";
export const revalidate = 3600;

/**
 * A real, complete cassette anyone can download and verify offline.
 *
 * The verifier and the spec are only a credible claim if a stranger can check
 * them without an account — and until now there was nothing for a CLI to
 * fetch. The record on /verify lives inside the page, which proves the point
 * to someone already reading the marketing site and to nobody else.
 *
 *   curl -O https://runback.dev/sample-cassette.json
 *   npx @runback/verify sample-cassette.json
 *
 * It is the same loan-approval incident shown throughout the site, so the
 * numbers a reader sees in the browser are the numbers they can verify on
 * their own machine.
 */
export async function GET() {
  return new Response(JSON.stringify(demoAuditRecord(), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Named so a browser download lands with a sensible filename.
      "content-disposition": 'inline; filename="sample-cassette.json"',
      "cache-control": "public, max-age=3600",
    },
  });
}
