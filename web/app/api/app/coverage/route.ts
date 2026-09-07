import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { agentCoverage, declareAgents, retireAgent, type DeclareInput } from "@/lib/coverage";
import { actorFrom } from "@/lib/adminAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRITICALITY = ["critical", "high", "standard", "low"] as const;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, coverage: await agentCoverage(session.orgId) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/**
 * Declare agents. Accepts one or many so a CMDB or risk-register export can be
 * pasted in — an inventory built one form submission at a time never gets built.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }
  let body: { agents?: DeclareInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const agents = (body.agents ?? []).filter((a) => a && typeof a.name === "string");
  if (!agents.length) return NextResponse.json({ ok: false, error: "No agents supplied." }, { status: 400 });
  for (const a of agents) {
    if (a.criticality && !CRITICALITY.includes(a.criticality)) {
      return NextResponse.json({ ok: false, error: `criticality must be one of: ${CRITICALITY.join(", ")}` }, { status: 400 });
    }
  }
  try {
    const n = await declareAgents(session.orgId, agents, actorFrom(session, req));
    return NextResponse.json({ ok: true, declared: n });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ ok: false, error: "An agent name is required." }, { status: 400 });
  try {
    await retireAgent(session.orgId, name, actorFrom(session, req));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
