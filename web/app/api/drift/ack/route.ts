import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Every other drift/topology route gates on this; a write action (ack) on a
  // paywalled feature must not be reachable just because it has no page-level
  // gate of its own. Checking only DEMO_MODE (not isDemoEmail too) left this
  // 403ing for the per-email demo login in production, same bug class as
  // drift/report — the recompute would work but acknowledging an alert would not.
  if (!DEMO_MODE && !isDemoEmail(session.email) && !await orgHasFeature(session.orgId, "drift"))
    return NextResponse.json({ error: "Behavioral drift detection requires Scale or above." }, { status: 403 });

  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  // Ensure the alert belongs to this org
  const { error } = await sb
    .from("ad_drift_alerts")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: session.email })
    .eq("id", id)
    .eq("org_id", session.orgId)
    .is("acknowledged_at", null);

  if (error) {
    console.error("[api/drift/ack] update failed:", error.message);
    return NextResponse.json({ error: "Could not acknowledge alert" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
