import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { listGolden } from "@/lib/golden";

export const runtime = "nodejs";

/** List the org's active golden tests. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!await orgHasFeature(session.orgId, "quality"))
    return NextResponse.json({ ok: false, error: "Golden corpus requires Growth plan or above." }, { status: 403 });
  return NextResponse.json({ ok: true, entries: await listGolden(session.orgId) });
}
