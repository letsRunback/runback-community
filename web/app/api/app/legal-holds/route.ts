import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { listHolds, placeHold, releaseHold } from "@/lib/legalHold";
import { actorFrom } from "@/lib/adminAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Legal holds suspend retention deletion. Admin+ and Enterprise only: a hold is
 * a preservation instruction with legal weight, not a user preference.
 */
async function guard(req: NextRequest) {
  const session = await getSession();
  if (!session) return { err: NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 }) };
  if (!atLeast(session.role, "admin")) {
    return { err: NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 }) };
  }
  if (!(await orgHasFeature(session.orgId, "compliance"))) {
    return { err: NextResponse.json({ ok: false, error: "Legal holds are available on Enterprise." }, { status: 403 }) };
  }
  return { session, actor: actorFrom(session, req) };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if ("err" in g) return g.err;
  try {
    return NextResponse.json({ ok: true, holds: await listHolds(g.session.orgId) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ("err" in g) return g.err;
  let body: { reason?: string; agentName?: string | null; coversFrom?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  try {
    const hold = await placeHold(g.session.orgId, {
      reason: body.reason ?? "",
      agentName: body.agentName ?? null,
      coversFrom: body.coversFrom ?? null,
    }, g.actor);
    return NextResponse.json({ ok: true, hold });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req);
  if ("err" in g) return g.err;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "A hold id is required." }, { status: 400 });
  try {
    await releaseHold(g.session.orgId, id, g.actor);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
