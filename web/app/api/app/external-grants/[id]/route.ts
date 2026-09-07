import { NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { revokeExternalGrant } from "@/lib/externalGrants";

export const runtime = "nodejs";

/** Revoke an external grant — Admin+, Enterprise ("compliance") only. Idempotent-ish: revoking twice just fails the second lookup (grant.revoked_at already set doesn't un-find it, so this returns 404 the second time, not a confusing "ok" on a no-op). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  if (!(await orgHasFeature(session.orgId, "compliance"))) {
    return NextResponse.json({ ok: false, error: "Available on Enterprise." }, { status: 403 });
  }
  const { id } = await params;
  const ok = await revokeExternalGrant(session.orgId, id, session.email);
  if (!ok) return NextResponse.json({ ok: false, error: "Grant not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
