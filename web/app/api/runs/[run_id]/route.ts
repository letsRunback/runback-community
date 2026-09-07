import { NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { getRun } from "@/lib/runs";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ run_id: string }> }
) {
  const { run_id } = await params;

  // Tenant isolation: only return a run that belongs to the caller's org. An
  // unscoped lookup here would be a cross-tenant IDOR — anyone with a run id
  // could read another org's full trace.
  //
  // getCaller (not getSession) because /docs documents this as a Bearer-token
  // endpoint; it was cookie-only, so every documented curl example 401'd.
  const caller = await getCaller(req);
  if (!caller) {
    return NextResponse.json({ error: "Not signed in, and no valid API key." }, { status: 401 });
  }

  const result = await getRun(run_id, caller.orgId);
  if (!result) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
