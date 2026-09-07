import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { getSink, saveSink, deleteSink, type SinkKind } from "@/lib/siem";
import { logAdminAction, actorFrom } from "@/lib/adminAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: SinkKind[] = ["splunk_hec", "sentinel", "webhook"];

async function guard(req: NextRequest) {
  const session = await getSession();
  if (!session) return { err: NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 }) };
  if (!atLeast(session.role, "admin")) {
    return { err: NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 }) };
  }
  if (!(await orgHasFeature(session.orgId, "compliance"))) {
    return { err: NextResponse.json({ ok: false, error: "SIEM export is available on Enterprise." }, { status: 403 }) };
  }
  return { session, actor: actorFrom(session, req) };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if ("err" in g) return g.err;
  try {
    // The token is never returned — only whether one is set.
    return NextResponse.json({ ok: true, sink: await getSink(g.session.orgId) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ("err" in g) return g.err;
  let body: { kind?: string; endpoint?: string; token?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  if (!KINDS.includes(body.kind as SinkKind)) {
    return NextResponse.json({ ok: false, error: `Collector type must be one of: ${KINDS.join(", ")}.` }, { status: 400 });
  }
  try {
    const sink = await saveSink(g.session.orgId, {
      kind: body.kind as SinkKind,
      endpoint: body.endpoint ?? "",
      token: body.token,
      enabled: body.enabled ?? true,
    });
    // Where audit evidence is sent is itself an auditable change — the endpoint
    // is recorded, the token never is.
    await logAdminAction({
      orgId: g.session.orgId, action: "org.settings_change", targetType: "siem_sink", targetId: sink.id,
      metadata: { kind: sink.kind, endpoint: sink.endpoint, enabled: sink.enabled, token_set: !!body.token },
      actor: g.actor,
    });
    return NextResponse.json({ ok: true, sink });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req);
  if ("err" in g) return g.err;
  try {
    await deleteSink(g.session.orgId);
    await logAdminAction({
      orgId: g.session.orgId, action: "org.settings_change", targetType: "siem_sink", targetId: "removed",
      metadata: { removed: true }, actor: g.actor,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
