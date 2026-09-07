import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { buildProofBundle } from "@/lib/proof";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ run_id: string }> }
) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Matches the demo bypass used by every other Enterprise-gated route
  // (compliance/report, regulatory, chargeback, ledger, models/diff, ...)
  // so the showcase/demo account can exercise this feature end-to-end.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  const allowed = demo || (await orgHasFeature(session.orgId, "proof"));
  if (!allowed) return NextResponse.json({ error: "Enterprise feature" }, { status: 403 });

  const { run_id } = await params;
  const bundle = await buildProofBundle(run_id, session.orgId);
  if (!bundle) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/octet-stream")) {
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="runback-proof-${run_id.slice(0, 10)}.json"`,
      },
    });
  }
  return NextResponse.json(bundle);
}
