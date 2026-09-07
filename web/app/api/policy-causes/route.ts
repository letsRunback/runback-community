import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { getPolicyCausesReport } from "@/lib/policyCauses";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await orgHasFeature(session.orgId, "policy_causes"))
    return NextResponse.json({ error: "Policy causal attribution requires Scale or above." }, { status: 403 });

  const url = new URL(req.url);
  const rawDays = url.searchParams.get("days") ?? "30";
  const windowDays = Math.min(90, Math.max(7, parseInt(rawDays, 10) || 30));

  const report = await getPolicyCausesReport(session.orgId, windowDays);
  return NextResponse.json(report);
}
