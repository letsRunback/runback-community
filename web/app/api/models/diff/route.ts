import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { getModelDiff, listOrgModels } from "@/lib/modelDiff";

export const dynamic = "force-dynamic";
// A real diff replays up to 5 runs live against the candidate model — several
// sequential model calls, not a single request. Give it real headroom.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const demo = DEMO_MODE || isDemoEmail(session.email);
  if (!demo && !await orgHasFeature(session.orgId, "model_diff"))
    return NextResponse.json({ error: "Upgrade to Scale to access model diff" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const modelA = searchParams.get("modelA");
  const modelB = searchParams.get("modelB");
  const days   = Math.min(90, Math.max(7, parseInt(searchParams.get("days") ?? "30", 10)));

  // List mode — just return models used in this org
  if (!modelA && !modelB) {
    const models = await listOrgModels(session.orgId, days);
    return NextResponse.json({ models });
  }

  if (!modelA || !modelB) return NextResponse.json({ error: "Both modelA and modelB required" }, { status: 400 });
  if (modelA === modelB) return NextResponse.json({ error: "modelA and modelB must be different" }, { status: 400 });

  const report = await getModelDiff(session.orgId, modelA, modelB, days, demo);
  if (!report) return NextResponse.json({ error: "No data for these models in the selected window" }, { status: 404 });
  return NextResponse.json(report);
}
