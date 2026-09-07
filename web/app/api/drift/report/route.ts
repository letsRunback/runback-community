import { NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { getDriftReport } from "@/lib/drift";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same demo exemption as every other Scale-gated route (DEMO_MODE OR the
  // per-email demo login) — checking only DEMO_MODE left this 403ing for the
  // hosted per-email demo account in production, where DEMO_MODE is unset.
  if (!DEMO_MODE && !isDemoEmail(session.email) && !await orgHasFeature(session.orgId, "drift"))
    return NextResponse.json({ error: "Behavioral drift detection requires Scale or above." }, { status: 403 });
  const report = await getDriftReport(session.orgId);
  return NextResponse.json(report);
}
