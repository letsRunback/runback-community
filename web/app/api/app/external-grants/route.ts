import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { issueExternalGrant, listExternalGrants, type GrantScopeType } from "@/lib/externalGrants";

export const runtime = "nodejs";

// NOTE: GrantScopeType (web/lib/externalGrants.ts) also defines "control_ids"
// as groundwork for a future compliance-narrative grant, but no route
// anywhere resolves an external_grant key against a control_id today —
// resolveExternalGrantForRun/grantCoversRun explicitly always reject it (see
// their doc comments). Issuing one here would hand an admin a
// completely non-functional credential that 401s on every endpoint, with no
// indication anything is wrong until the auditor tries to use it. Deliberately
// excluded from the issuable set until a real consumer exists; re-add once one
// does.
const SCOPE_TYPES: GrantScopeType[] = ["run_ids", "org_wide"];
const MAX_EXPIRY_DAYS = 365;

interface IssueBody {
  label?: string;
  scope_type?: string;
  run_ids?: string[];
  control_ids?: string[];
  expires_in_days?: number;
}

/** List an org's issued external grants (Admin+, Enterprise "compliance" feature) — never the raw key. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  if (!(await orgHasFeature(session.orgId, "compliance"))) {
    return NextResponse.json({ ok: false, error: "Available on Enterprise." }, { status: 403 });
  }
  try {
    const grants = await listExternalGrants(session.orgId);
    return NextResponse.json({ ok: true, grants });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Issue a new external_grant key (shown once) — Admin+, Enterprise ("compliance") only. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  if (!(await orgHasFeature(session.orgId, "compliance"))) {
    return NextResponse.json({ ok: false, error: "Available on Enterprise." }, { status: 403 });
  }

  let body: IssueBody;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }

  if (!body.label || typeof body.label !== "string" || !body.label.trim()) {
    return NextResponse.json({ ok: false, error: "label is required" }, { status: 400 });
  }
  if (!body.scope_type || !SCOPE_TYPES.includes(body.scope_type as GrantScopeType)) {
    return NextResponse.json({ ok: false, error: `scope_type must be one of: ${SCOPE_TYPES.join(", ")}` }, { status: 400 });
  }
  const scopeType = body.scope_type as GrantScopeType;
  if (scopeType === "run_ids" && (!Array.isArray(body.run_ids) || body.run_ids.length === 0)) {
    return NextResponse.json({ ok: false, error: "run_ids (non-empty array) is required for scope_type=run_ids" }, { status: 400 });
  }
  const days = Number(body.expires_in_days);
  if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRY_DAYS) {
    return NextResponse.json({ ok: false, error: `expires_in_days must be a number between 1 and ${MAX_EXPIRY_DAYS}` }, { status: 400 });
  }
  const expiresAt = new Date(Date.now() + days * 86400_000).toISOString();

  const result = await issueExternalGrant({
    orgId: session.orgId,
    issuedBy: session.email,
    label: body.label.trim(),
    scopeType,
    runIds: body.run_ids,
    controlIds: body.control_ids,
    expiresAt,
  });
  if (!result) return NextResponse.json({ ok: false, error: "Could not create a grant." }, { status: 500 });
  return NextResponse.json({ ok: true, apiKey: result.apiKey, grant: result.grant });
}
