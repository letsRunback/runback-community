import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { getCostAttribution } from "@/lib/costAttr";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await orgHasFeature(session.orgId, "cost_attribution"))
    return NextResponse.json({ error: "Upgrade to Scale to access cost attribution" }, { status: 403 });

  const days = Math.min(90, Math.max(7, parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10)));
  const report = await getCostAttribution(session.orgId, days);
  return NextResponse.json(report);
}
