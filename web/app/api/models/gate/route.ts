import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { runUpgradeGate, listGates, setGateThresholds } from "@/lib/upgradeGate";

export const dynamic = "force-dynamic";
// A real gate run replays up to 10 golden entries live against the candidate
// model — several sequential model calls, not a single request.
export const maxDuration = 120;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const demo = DEMO_MODE || isDemoEmail(session.email);
  if (!demo && !await orgHasFeature(session.orgId, "upgrade_gate"))
    return NextResponse.json({ error: "Upgrade to Scale to access the upgrade gate" }, { status: 403 });

  const gates = await listGates(session.orgId);
  return NextResponse.json({ gates });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const demo = DEMO_MODE || isDemoEmail(session.email);
  if (!demo && !await orgHasFeature(session.orgId, "upgrade_gate"))
    return NextResponse.json({ error: "Upgrade to Scale to access the upgrade gate" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // Threshold update — admin only, kept on this same route to avoid a new
  // settings surface for two numbers.
  if (body.action === "set_thresholds") {
    if (!atLeast(session.role, "admin")) return NextResponse.json({ error: "Only an admin/owner can change gate thresholds" }, { status: 403 });
    const passThreshold = Number(body.passThreshold);
    const warnThreshold = Number(body.warnThreshold);
    if (!Number.isFinite(passThreshold) || !Number.isFinite(warnThreshold))
      return NextResponse.json({ error: "passThreshold and warnThreshold must be numbers" }, { status: 400 });
    try {
      await setGateThresholds(session.orgId, passThreshold, warnThreshold);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid thresholds" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  const fromModel = typeof body.fromModel === "string" ? body.fromModel : null;
  const toModel = typeof body.toModel === "string" ? body.toModel : null;
  if (!fromModel || !toModel) return NextResponse.json({ error: "fromModel and toModel required" }, { status: 400 });
  if (fromModel === toModel)  return NextResponse.json({ error: "Models must be different" }, { status: 400 });

  const report = await runUpgradeGate(session.orgId, fromModel, toModel, demo);
  return NextResponse.json(report);
}
