import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { ledgerStatus, verifyLedger, sealCheckpoint } from "@/lib/ledger";
import { tenantIsolationActive } from "@/lib/supabase/tenant";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { logAdminAction, actorFrom } from "@/lib/adminAudit";

export const runtime = "nodejs";
export const maxDuration = 60;

const isDemo = (session: { email?: string }) => DEMO_MODE || isDemoEmail(session.email);

/** The tamper-evident ledger is an Enterprise feature. Demo accounts are exempt. */
async function ledgerAllowed(session: { orgId: string; email?: string }): Promise<boolean> {
  if (isDemo(session)) return true;
  return orgHasFeature(session.orgId, "ledger");
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!(await ledgerAllowed(session))) return NextResponse.json({ ok: false, error: "The audit ledger is an Enterprise feature." }, { status: 402 });
  return NextResponse.json({ ok: true, status: await ledgerStatus(session.orgId, isDemo(session)) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!(await ledgerAllowed(session))) return NextResponse.json({ ok: false, error: "The audit ledger is an Enterprise feature." }, { status: 402 });
  const demo = isDemo(session);

  let body: { action?: string };
  try { body = await req.json(); } catch { body = {}; }

  if (body.action === "seal") {
    if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Only an admin/owner can seal a checkpoint." }, { status: 403 });
    const cp = await sealCheckpoint(session.orgId, demo);
    if (!cp) return NextResponse.json({ ok: false, error: "Nothing to seal — the ledger is empty." }, { status: 400 });
    // Sealing sets the anchor every later tamper check is measured against, so
    // who sealed and when is itself audit-relevant. /security lists this as
    // recorded; it was not.
    await logAdminAction({
      orgId: session.orgId,
      action: "ledger.seal",
      targetType: "checkpoint",
      targetId: String(cp.seq),
      actor: actorFrom(session, req),
      metadata: { signed: cp.signed },
    });
    return NextResponse.json({ ok: true, sealed: cp });
  }
  // default: verify
  return NextResponse.json({
    ok: true,
    verification: await verifyLedger(session.orgId, demo),
    // Whether THIS deployment's reads were enforced by the database, not just
    // filtered by application code. lib/supabase/tenant.ts computed this from
    // the start and nothing ever read it, so there was no way — from inside or
    // outside — to tell an enforcing deployment from one silently falling back
    // to the service-role client. That ambiguity is what made a broken RLS
    // rollout look identical to a healthy one.
    tenant_isolation: tenantIsolationActive(),
  });
}
