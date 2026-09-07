import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { issueScimKey } from "@/lib/apiKeys";
import { logAdminAction, actorFrom } from "@/lib/adminAudit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Issue the bearer token an identity provider presents to /api/scim/v2.
 *
 * Shown once. Rotating replaces the previous token: an IdP holds exactly one
 * credential, and leaving old ones live means a decommissioned connector can
 * still add and remove people.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  if (!(await orgHasFeature(session.orgId, "sso"))) {
    return NextResponse.json({ ok: false, error: "SCIM provisioning is available on Enterprise." }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { error: revokeErr } = await sb
    .from("api_keys").update({ active: false }).eq("org_id", session.orgId).eq("scope", "scim").eq("active", true);
  if (revokeErr) {
    return NextResponse.json({ ok: false, error: `Could not retire the previous token: ${revokeErr.message}` }, { status: 500 });
  }

  // Rotation retires the previous token, and retiring a credential is its own
  // audit event — recording only the replacement left "who revoked IdP access,
  // and when" absent from a log that claims to hold exactly that.
  await logAdminAction({
    orgId: session.orgId, action: "api_key.revoke", targetType: "scim_token", targetId: "previous",
    metadata: { scope: "scim", reason: "rotated" },
    actor: actorFrom(session, req),
  });

  const key = await issueScimKey(session.email, session.orgId);
  if (!key) return NextResponse.json({ ok: false, error: "Could not create a token." }, { status: 500 });

  await logAdminAction({
    orgId: session.orgId, action: "api_key.create", targetType: "scim_token", targetId: key.slice(0, 16),
    metadata: { scope: "scim", rotated: true },
    actor: actorFrom(session, req),
  });

  return NextResponse.json({ ok: true, apiKey: key });
}
