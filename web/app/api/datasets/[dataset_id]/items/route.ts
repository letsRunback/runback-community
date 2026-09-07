import { NextRequest, NextResponse } from "next/server";
import { addItem, getDataset, loadCapturedStep } from "@/lib/eval/datasets";
import type { ScorerConfig } from "@/lib/eval/scorers";

export const runtime = "nodejs";

interface AddItemBody {
  source_run_id?: string;
  source_span_id?: string;
  label?: string;
  scorers?: ScorerConfig[];
}

/** Snapshot a captured LLM step (identified by run + span) into a dataset. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dataset_id: string }> }
) {
  const { dataset_id } = await params;

  // Auth + tenant isolation: the caller must own BOTH the dataset and the source run.
  const { getSession } = await import("@/lib/auth");
  const session = await getSession().catch(() => null);
  if (!session?.orgId) {
    return NextResponse.json({ error: "Sign in to add to a dataset." }, { status: 401 });
  }

  let body: AddItemBody;
  try {
    body = (await req.json()) as AddItemBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.source_run_id || !body.source_span_id) {
    return NextResponse.json(
      { error: "source_run_id and source_span_id are required" },
      { status: 400 }
    );
  }

  // The dataset must belong to the caller's org before we write into it.
  const owned = await getDataset(dataset_id, session.orgId);
  if (!owned) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const captured = await loadCapturedStep(body.source_run_id, body.source_span_id, session.orgId);
  if (!captured) {
    return NextResponse.json(
      { error: "No LLM step found for that run_id / span_id" },
      { status: 404 }
    );
  }

  // Default to a single no_error assertion so every item is at least a smoke test.
  const scorers: ScorerConfig[] =
    body.scorers && body.scorers.length > 0 ? body.scorers : [{ type: "no_error" }];

  const label =
    body.label?.trim() ||
    `${captured.model.model_id} · ${captured.span_id.slice(0, 8)}`;

  try {
    const item = await addItem({
      dataset_id,
      label,
      request: captured.request,
      model: captured.model,
      scorers,
      source_run_id: body.source_run_id,
      source_span_id: body.source_span_id,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    console.error("[api/datasets/items] add failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not add item" }, { status: 500 });
  }
}
