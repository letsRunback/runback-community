import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { getChargebackReport } from "@/lib/chargeback";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same demo exemption as every other Enterprise-gated route in this family
  // (/api/chargeback/teams, /api/chargeback/export) — checking orgHasFeature
  // alone would 403 this for the per-email demo login in production, same bug
  // class fixed there. No in-app caller currently hits this bare route (the
  // Cost page reads getChargebackReport server-side directly), but it's part
  // of the documented API surface (see app/docs/page.tsx) and should behave
  // the same as its siblings.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  if (!demo && !await orgHasFeature(session.orgId, "chargeback")) {
    return NextResponse.json({ error: "Chargeback reporting requires Enterprise — contact us to upgrade." }, { status: 403 });
  }

  // A non-numeric ?days (e.g. "abc") makes parseInt return NaN, which
  // Math.max/Math.min pass through unchanged — days would stay NaN and crash
  // getChargebackReport's `new Date(Date.now() - days * 86400_000)` with
  // "Invalid time value" once .toISOString() runs. `|| 30` catches it first.
  const days = Math.min(90, Math.max(7, parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10) || 30));
  const report = await getChargebackReport(session.orgId, days);
  return NextResponse.json(report);
}
