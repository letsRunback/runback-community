import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { getAdminClient } from "@/lib/supabase/admin";
import { getFindingsForRun, verifyStoredFinding } from "@/lib/securityFindings";

export const runtime = "nodejs";
export const maxDuration = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function GET(req: NextRequest, { params }: { params: Promise<{ run_id: string }> }) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same entitlement as the compliance-evidence key that issues findings
  // credentials in the first place (Settings) — findings ARE compliance
  // evidence, not a separate paid tier.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  const allowed = demo || (await orgHasFeature(session.orgId, "compliance"));
  if (!allowed) return NextResponse.json({ error: "Enterprise feature" }, { status: 403 });

  const { run_id } = await params;
  const { data: run } = await db().from("ad_runs").select("org_id").eq("run_id", run_id).maybeSingle();
  if (!run || run.org_id !== session.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const findings = await getFindingsForRun(session.orgId, run_id);
    const withVerification = findings.map((f) => ({ ...f, verification: verifyStoredFinding(f) }));
    return NextResponse.json({ findings: withVerification });
  } catch (e) {
    return NextResponse.json({ error: "Fetch failed", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
