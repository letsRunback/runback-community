import { NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { issueSecurityFindingsKey } from "@/lib/apiKeys";

export const runtime = "nodejs";

/**
 * Issue a security_findings key (shown once) — Admin+, Enterprise
 * ("compliance" feature) only. Mirrors /api/app/compliance-key exactly: this
 * key can only ever POST to /api/security-findings; it has no ingest or
 * dashboard access.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  if (!(await orgHasFeature(session.orgId, "compliance"))) {
    return NextResponse.json({ ok: false, error: "Available on Enterprise." }, { status: 403 });
  }
  const key = await issueSecurityFindingsKey(session.email, session.orgId);
  if (!key) return NextResponse.json({ ok: false, error: "Could not create a key." }, { status: 500 });
  return NextResponse.json({ ok: true, apiKey: key });
}
