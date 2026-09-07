import { NextRequest, NextResponse } from "next/server";
import { getSession, type Role } from "@/lib/auth";
import { actorFrom } from "@/lib/adminAudit";
import { orgHasFeature } from "@/lib/planGate";
import { inviteMember, changeRole, removeMember, revokeMemberSessions } from "@/lib/team";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!await orgHasFeature(session.orgId, "rbac"))
    return NextResponse.json({ ok: false, error: "Team management is a Pro/Enterprise feature." }, { status: 403 });

  let body: { action?: string; email?: string; role?: Role; userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  let result;
  switch (body.action) {
    case "invite":
      result = await inviteMember(session.orgId, session.role, body.email || "", body.role || "member", base);
      break;
    case "role":
      result = await changeRole(session.orgId, session.role, body.userId || "", body.role || "member", actorFrom(session, req));
      break;
    case "remove":
      result = await removeMember(session.orgId, session.role, body.userId || "", actorFrom(session, req));
      break;
    case "revoke_sessions":
      result = await revokeMemberSessions(session.orgId, session.role, body.userId || "", actorFrom(session, req));
      break;
    default:
      return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 403 });
}
