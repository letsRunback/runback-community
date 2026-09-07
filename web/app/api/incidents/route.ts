import { NextRequest, NextResponse } from "next/server";
import { getCaller, actorLabel } from "@/lib/apiAuth";
import { atLeast } from "@/lib/auth";
import { createIncident, listIncidents, VALID_SEVERITIES, VALID_STATUSES, type IncidentSeverity, type IncidentStatus } from "@/lib/incidents";
import { orgHasFeature } from "@/lib/planGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false }, { status: 401 });
  if (!await orgHasFeature(caller.orgId, "incidents")) return NextResponse.json({ ok: false, error: "Incidents require Growth or above." }, { status: 403 });

  const statusParam = req.nextUrl.searchParams.get("status");
  if (statusParam !== null && !VALID_STATUSES.includes(statusParam as IncidentStatus))
    return NextResponse.json({ ok: false, error: "Unknown status." }, { status: 400 });
  const status = statusParam as IncidentStatus | null;
  const rows = await listIncidents(caller.orgId, status ?? undefined);
  return NextResponse.json({ ok: true, incidents: rows });
}

export async function POST(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false }, { status: 401 });
  if (!atLeast(caller.role, "member")) return NextResponse.json({ ok: false, error: "Member access required." }, { status: 403 });
  if (!await orgHasFeature(caller.orgId, "incidents")) return NextResponse.json({ ok: false, error: "Incidents require Growth or above." }, { status: 403 });

  let body: {
    run_id?: string;
    run_name?: string;
    title?: string;
    severity?: IncidentSeverity;
    root_cause?: string;
    initial_note?: string;
  };
  try { body = await req.json(); } catch { body = {}; }

  if (!body.run_id) return NextResponse.json({ ok: false, error: "run_id required." }, { status: 400 });
  if (body.severity !== undefined && !VALID_SEVERITIES.includes(body.severity))
    return NextResponse.json({ ok: false, error: "Unknown severity." }, { status: 400 });

  const incident = await createIncident({
    org_id:       caller.orgId,
    run_id:       body.run_id,
    run_name:     body.run_name ?? null,
    title:        body.title ?? `Incident — ${body.run_id.slice(0, 8)}`,
    severity:     body.severity ?? "medium",
    root_cause:   body.root_cause ?? null,
    created_by:   actorLabel(caller),
    initial_note: body.initial_note,
  });

  if (!incident) return NextResponse.json({ ok: false, error: "Failed to create incident." }, { status: 500 });
  return NextResponse.json({ ok: true, incident });
}
