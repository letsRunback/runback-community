import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { approveRun, dismissRun } from "@/lib/golden";

export const runtime = "nodejs";

/** Approve or dismiss a golden corpus entry. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "member")) return NextResponse.json({ ok: false, error: "Member access required." }, { status: 403 });
  // GoldenActions renders Approve/Dismiss on every row of the demo report
  // (app/golden/page.tsx bypasses entitlement for DEMO_MODE OR a per-email
  // demo login — see `demo` there). Checking only DEMO_MODE here left this
  // 403ing on every click for the per-email demo login in production, where
  // DEMO_MODE is unset — same bug class as golden/enroll and golden/run.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  if (!demo && !await orgHasFeature(session.orgId, "quality"))
    return NextResponse.json({ ok: false, error: "Golden corpus requires Growth plan or above." }, { status: 403 });

  let body: { id?: string; action?: string };
  try { body = await req.json(); } catch { body = {}; }

  const { id, action } = body;
  if (!id || (action !== "approve" && action !== "dismiss")) {
    return NextResponse.json({ ok: false, error: "id and action (approve|dismiss) are required." }, { status: 400 });
  }

  try {
    if (action === "approve") {
      await approveRun(session.orgId, id, session.email);
    } else {
      await dismissRun(session.orgId, id);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Action failed." }, { status: 500 });
  }
}
