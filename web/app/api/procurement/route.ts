import { NextResponse } from "next/server";
import { CAIQ, regulatoryMapping } from "@/lib/trustCenter";

export const dynamic = "force-dynamic"; // regulatoryMapping() reads live EU AI Act enforcement state

/**
 * Machine-readable trust center — the same content /procurement renders for
 * a human, structured for a vendor-assessment tool or a procurement
 * analyst's own script to pull directly. The self-serve half of closing the
 * loop: a reviewer who wants an answer shouldn't have to book a call to get
 * data this page already states publicly.
 *
 * Named /api/procurement, not /api/trust — "trust" in this codebase already
 * names the inter-agent delegation trust-chain feature (/api/trust/verify,
 * /api/trust/chain, lib/trust.ts). Reusing it for vendor-assessment content
 * would collide two unrelated meanings under one path.
 */
export async function GET() {
  return NextResponse.json(
    {
      trust_center: "runback-procurement/v1",
      generated_at: new Date().toISOString(),
      note: "Answers reflect shipped mechanisms, not intentions. Gaps (no SOC 2, no third-party pentest) are stated plainly, not omitted.",
      regulatory_mapping: regulatoryMapping(),
      caiq: CAIQ,
      documents: {
        security_overview: "https://runback.dev/security",
        dpa: "https://runback.dev/dpa",
        terms: "https://runback.dev/terms",
        privacy: "https://runback.dev/privacy",
        procurement_page: "https://runback.dev/procurement",
        signed_dpa_request: "legal@runback.dev",
      },
    },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}
