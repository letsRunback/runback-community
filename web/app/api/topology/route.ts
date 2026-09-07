import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { getTopologyReport } from "@/lib/topology";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Reachable straight from the "Runs" nav with no page-level gate/upsell of its
  // own (unlike golden/cost-teams), so a demo visitor with no bypass here just
  // hits a 403. Exempt demo mode to match every other showcased feature — and,
  // like every other showcased route, exempt the per-email hosted demo login
  // too: DEMO_MODE alone is unset in production, so demo@runback.dev would 403
  // here unless its org happens to carry the "topology" entitlement.
  if (!DEMO_MODE && !isDemoEmail(session.email) && !await orgHasFeature(session.orgId, "topology"))
    return NextResponse.json({ error: "Fleet topology requires Scale or above." }, { status: 403 });
  const days = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10);
  const window = [7, 30, 90].includes(days) ? days : 30;
  const report = await getTopologyReport(session.orgId, window);
  return NextResponse.json(report);
}
