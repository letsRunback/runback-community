import { NextRequest, NextResponse } from "next/server";
import { createDataset, listDatasets } from "@/lib/eval/datasets";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Tenant isolation: only the caller's own datasets — never the whole table.
    const { getSession } = await import("@/lib/auth");
    const session = await getSession().catch(() => null);
    // 200 with an empty list told an unauthenticated caller "you have no
    // datasets" rather than "you are not signed in" — indistinguishable from a
    // real empty account, so a broken session looked like missing data. Every
    // other authenticated route here answers 401; this one now matches.
    if (!session?.orgId) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const datasets = await listDatasets(session.orgId);
    return NextResponse.json({ datasets });
  } catch (err) {
    // Logged server-side, not returned — the raw message can carry internal
    // schema/implementation detail (table/column names, "has migration X been
    // applied?" hints) that an authenticated caller doesn't need to see.
    console.error("[api/datasets] GET failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not list datasets" }, { status: 500 });
  }
}

interface CreateBody {
  name?: string;
  description?: string;
  /** When the dataset is created from a captured step, scope it to that run's project. */
  source_run_id?: string;
}

export async function POST(req: NextRequest) {
  const { getSession } = await import("@/lib/auth");
  const session = await getSession().catch(() => null);
  if (!session?.orgId) return NextResponse.json({ error: "Sign in to create a dataset." }, { status: 401 });
  const { atLeast } = await import("@/lib/auth");
  if (!atLeast(session.role, "member")) {
    return NextResponse.json({ error: "Viewers have read-only access." }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const dataset = await createDataset({
      name,
      description: body.description?.trim() || null,
      source_run_id: body.source_run_id ?? null,
      org_id: session.orgId,
    });
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (err) {
    console.error("[api/datasets] POST failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not create dataset" }, { status: 500 });
  }
}
