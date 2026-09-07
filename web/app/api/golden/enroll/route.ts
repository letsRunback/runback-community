import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { enrollRun } from "@/lib/golden";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Manually enroll a run in the golden corpus. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "member")) return NextResponse.json({ ok: false, error: "Member access required." }, { status: 403 });
  // EnrollButton on app/runs/[run_id] renders for ANY failing/blocked run
  // regardless of plan (see showEnroll there); this route must exempt demo
  // mode to match, or the button 403s every time in the hosted demo. Checking
  // only DEMO_MODE (not isDemoEmail too) meant it still 403'd for the
  // per-email demo login in production, where DEMO_MODE is unset.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  if (!demo && !await orgHasFeature(session.orgId, "quality"))
    return NextResponse.json({ ok: false, error: "Golden corpus requires Growth plan or above." }, { status: 403 });

  let body: { run_id?: string; reason?: string; detail?: string };
  try { body = await req.json(); } catch { body = {}; }

  const { run_id, reason, detail } = body;
  if (!run_id || !reason || (reason !== "policy_block" && reason !== "error")) {
    return NextResponse.json({ ok: false, error: "run_id and reason (policy_block|error) are required." }, { status: 400 });
  }

  // Verify the run belongs to this org before enrolling it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: runScope } = await sb.from("ad_runs").select("org_id").eq("run_id", run_id).maybeSingle();
  if (!runScope || runScope.org_id !== session.orgId) {
    return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
  }

  try {
    await enrollRun(session.orgId, run_id, reason, detail ?? reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Enroll failed." }, { status: 500 });
  }
}
