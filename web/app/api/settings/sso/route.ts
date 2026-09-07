import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast, type Role } from "@/lib/auth";
import { actorFrom } from "@/lib/adminAudit";
import { orgHasFeature } from "@/lib/planGate";
import { saveSsoConfig, assertSafeIssuer } from "@/lib/sso";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });

  // Fresh plan check — don't rely on stale session.orgPlan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: orgRow } = await sb.from("orgs").select("plan,trial_ends_at").eq("id", session.orgId).maybeSingle();
  if (!orgRow) return NextResponse.json({ ok: false, error: "Org not found." }, { status: 404 });
  if (!await orgHasFeature(session.orgId, "sso")) return NextResponse.json({ ok: false, error: "SSO is an Enterprise feature." }, { status: 403 });

  let body: { enabled?: boolean; issuer?: string; clientId?: string; clientSecret?: string; domains?: string[]; defaultRole?: Role };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 }); }

  if (body.enabled && (!body.issuer || !body.clientId || !(body.domains?.length))) {
    return NextResponse.json({ ok: false, error: "Issuer, client ID, and at least one domain are required to enable SSO." }, { status: 422 });
  }
  if (body.issuer) {
    try { assertSafeIssuer(body.issuer); } catch (e) {
      return NextResponse.json({ ok: false, error: `Issuer URL invalid: ${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
    }
  }
  if (body.defaultRole !== undefined && body.defaultRole !== "admin" && body.defaultRole !== "member")
    return NextResponse.json({ ok: false, error: "defaultRole must be 'admin' or 'member'." }, { status: 422 });
  const safeDefaultRole: Role = (body.defaultRole === "admin") ? "admin" : "member";
  await saveSsoConfig(session.orgId, {
    enabled: !!body.enabled,
    issuer: body.issuer || "",
    clientId: body.clientId || "",
    clientSecret: body.clientSecret,
    domains: body.domains || [],
    defaultRole: safeDefaultRole,
  }, actorFrom(session, req));
  return NextResponse.json({ ok: true });
}
