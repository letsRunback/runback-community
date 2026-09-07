import { NextRequest, NextResponse } from "next/server";
import { getDataset, reviewSyntheticItem } from "@/lib/eval/datasets";

export const runtime = "nodejs";

interface ReviewBody {
  decision?: "approved" | "rejected";
}

/**
 * A human approves or rejects an LLM-proposed scenario. Only this action can
 * move a synthetic item out of "pending" — nothing automated does it, which
 * is the whole point (see web/lib/eval/adversarial.ts).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ dataset_id: string; item_id: string }> }
) {
  const { dataset_id, item_id } = await params;

  const { getSession } = await import("@/lib/auth");
  const session = await getSession().catch(() => null);
  if (!session?.orgId || !session.email) {
    return NextResponse.json({ error: "Sign in to review a scenario." }, { status: 401 });
  }

  let body: ReviewBody;
  try {
    body = (await req.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }

  // The dataset must belong to the caller's org before we touch its items.
  const owned = await getDataset(dataset_id, session.orgId);
  if (!owned) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

  try {
    const reviewed = await reviewSyntheticItem(item_id, dataset_id, body.decision, session.email);
    if (!reviewed) {
      return NextResponse.json(
        { error: "Nothing to review — item isn't a pending synthetic scenario, or doesn't exist." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, decision: body.decision });
  } catch (err) {
    console.error("[api/datasets/items/review] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not record review" }, { status: 500 });
  }
}
