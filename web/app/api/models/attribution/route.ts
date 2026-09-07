import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { getModelAttribution } from "@/lib/modelAttr";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await orgHasFeature(session.orgId, "model_attribution");
  if (!allowed) return NextResponse.json({ error: "Pro feature" }, { status: 403 });

  const url = new URL(req.url);
  const windowDays = Math.min(90, Math.max(7, Number(url.searchParams.get("days") ?? "30")));
  const report = await getModelAttribution(session.orgId, windowDays);
  return NextResponse.json(report);
}
