import { NextRequest, NextResponse } from "next/server";
import { getCaller, actorLabel } from "@/lib/apiAuth";
import { atLeast } from "@/lib/auth";
import { getIncident, updateIncident, VALID_STATUSES, VALID_SEVERITIES, type IncidentStatus, type IncidentSeverity } from "@/lib/incidents";
import { orgHasFeature } from "@/lib/planGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false }, { status: 401 });
  if (!await orgHasFeature(caller.orgId, "incidents")) return NextResponse.json({ ok: false }, { status: 403 });

  const incident = await getIncident(id, caller.orgId);
  if (!incident) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, incident });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false }, { status: 401 });
  if (!atLeast(caller.role, "member")) return NextResponse.json({ ok: false, error: "Member access required." }, { status: 403 });
  if (!await orgHasFeature(caller.orgId, "incidents")) return NextResponse.json({ ok: false }, { status: 403 });

  let body: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    root_cause?: string;
    remediation?: string;
    golden_run_id?: string;
    note?: string;
  };
  try { body = await req.json(); } catch { body = {}; }

  // Reject an unrecognized status/severity up front rather than writing it —
  // see the comment on VALID_STATUSES in lib/incidents.ts for why an invalid
  // status is a dead end, not just a display glitch.
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status))
    return NextResponse.json({ ok: false, error: "Unknown status." }, { status: 400 });
  if (body.severity !== undefined && !VALID_SEVERITIES.includes(body.severity))
    return NextResponse.json({ ok: false, error: "Unknown severity." }, { status: 400 });

  const { note, ...patch } = body;
  const result = await updateIncident(id, caller.orgId, patch, actorLabel(caller), note);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 409;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, incident: result.incident });
}
