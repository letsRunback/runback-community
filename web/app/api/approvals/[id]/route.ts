import { NextRequest, NextResponse } from "next/server";
import { atLeast } from "@/lib/auth";
import { getCaller, actorLabel } from "@/lib/apiAuth";
import { getApproval, decideApproval } from "@/lib/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/approvals/:id — poll status (SDK waiting for decision) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false }, { status: 401 });

  const approval = await getApproval(id, caller.orgId);
  if (!approval) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, approval });
}

/** PATCH /api/approvals/:id — decide (admin only) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false }, { status: 401 });
  // A human-in-the-loop control the automation can satisfy itself is not a
  // control. apiAuth resolves every rb_live_ ingest key to role "admin", and
  // that key is embedded in each instrumented app — the same credential the
  // agent uses to REQUEST an approval would otherwise pass the check below and
  // approve it. The decision requires a browser session; GET (the SDK polling
  // for an answer) is deliberately still open to keys.
  if (caller.via !== "session") {
    return NextResponse.json(
      { ok: false, error: "Approval decisions require a signed-in user, not an API key." },
      { status: 403 }
    );
  }
  if (!atLeast(caller.role, "admin")) {
    return NextResponse.json({ ok: false, error: "Only an admin can make approval decisions." }, { status: 403 });
  }

  let body: { decision?: string; note?: string };
  try { body = await req.json(); } catch { body = {}; }

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json({ ok: false, error: "decision must be 'approved' or 'rejected'." }, { status: 400 });
  }

  // actorLabel, not the bare email: an approval decided by a CI key must never
  // be indistinguishable from one a person clicked. That distinction IS the
  // governance record — a human-in-the-loop control that cannot tell the two
  // apart is not a control.
  const approval = await decideApproval(id, caller.orgId, body.decision, body.note ?? "", actorLabel(caller));
  if (!approval) return NextResponse.json({ ok: false, error: "Approval not found or already decided." }, { status: 404 });
  return NextResponse.json({ ok: true, approval });
}
