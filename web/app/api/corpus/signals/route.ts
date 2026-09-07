import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { getCorpusSignals } from "@/lib/corpus";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  void req;
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await orgHasFeature(session.orgId, "corpus");
  if (!allowed) return NextResponse.json({ error: "Pro feature" }, { status: 403 });

  const overview = await getCorpusSignals(session.orgId);
  return NextResponse.json(overview);
}
