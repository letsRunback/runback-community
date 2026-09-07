import { NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { getGoldenReport } from "@/lib/golden";

export const runtime = "nodejs";

/** Return the golden corpus flywheel report for the org. */
export async function GET(req: Request) {
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!await orgHasFeature(session.orgId, "quality"))
    return NextResponse.json({ ok: false, error: "Golden corpus requires Growth plan or above." }, { status: 403 });

  try {
    const report = await getGoldenReport(session.orgId);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Report failed." }, { status: 500 });
  }
}
