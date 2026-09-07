import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { createApproval, listApprovals } from "@/lib/approvals";
import { sendApprovalNotification } from "@/lib/email";
import { orgHasFeature } from "@/lib/planGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/approvals — list approvals for the org (admins see all; members see pending only) */
export async function GET(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status") as "pending" | "approved" | "rejected" | "timed_out" | null;
  const rows = await listApprovals(caller.orgId, status ?? undefined);
  return NextResponse.json({ ok: true, approvals: rows });
}

/** POST /api/approvals — SDK creates an approval request */
export async function POST(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false, error: "Not signed in, and no valid API key." }, { status: 401 });
  if (!await orgHasFeature(caller.orgId, "approvals")) {
    return NextResponse.json({ ok: false, error: "Approval queue requires Starter or above." }, { status: 403 });
  }

  let body: {
    run_id?: string;
    span_id?: string;
    policy_name?: string;
    rule_id?: string;
    rule_desc?: string;
    context?: Record<string, unknown>;
    ttl_seconds?: number;
  };
  try { body = await req.json(); } catch { body = {}; }

  if (!body.run_id) return NextResponse.json({ ok: false, error: "run_id required." }, { status: 400 });

  const ttl = Math.min(body.ttl_seconds ?? 3600, 86400);
  const expires_at = new Date(Date.now() + ttl * 1000).toISOString();

  const approval = await createApproval({
    org_id: caller.orgId,
    run_id: body.run_id,
    span_id: body.span_id ?? null,
    policy_name: body.policy_name ?? null,
    rule_id: body.rule_id ?? null,
    rule_desc: body.rule_desc ?? null,
    context: body.context ?? {},
    expires_at,
  });

  if (!approval) return NextResponse.json({ ok: false, error: "Failed to create approval." }, { status: 500 });

  // Fire-and-forget notification to org admins.
  sendApprovalNotification(caller.orgId, approval).catch(() => {});

  return NextResponse.json({ ok: true, approval });
}
