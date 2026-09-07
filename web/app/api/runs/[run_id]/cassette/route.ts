import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRun } from "@/lib/runs";
import { resolveApiKey } from "@/lib/ingest";

export const runtime = "nodejs";

/**
 * Return a run's events so the SDK can rebuild a replayable cassette and re-run the
 * agent against it (code-driven counterfactual / prompt-rebuild). Authed by a
 * Bearer API key (for CI/SDK use) or a signed-in session, and scoped to the org.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ run_id: string }> }) {
  const { run_id } = await params;

  let orgId: string | null = null;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const key = await resolveApiKey(auth.slice(7));
    if (!key) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });
    orgId = key.orgId;
  } else {
    const session = await getSession().catch(() => null);
    if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    orgId = session.orgId;
  }

  const data = await getRun(run_id, orgId);
  if (!data) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run_id, events: data.events });
}
