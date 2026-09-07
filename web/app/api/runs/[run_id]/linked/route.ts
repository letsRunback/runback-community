import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { getAgentGraph } from "@/lib/multiAgent";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ run_id: string }> }
) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await orgHasFeature(caller.orgId, "multiagent");
  if (!allowed) return NextResponse.json({ error: "Pro feature" }, { status: 403 });

  const { run_id } = await params;
  const graph = await getAgentGraph(run_id, caller.orgId);
  if (!graph) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(graph);
}
