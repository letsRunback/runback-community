import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { setHumanVerdict } from "@/lib/eval/pairwise";

export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const WINNERS = ["a", "b", "tie"] as const;

/** A human overrides one item's verdict. No model call — no rate limit needed. */
export async function POST(req: NextRequest) {
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) {
    return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  }
  // Writes the `eval.pairwise_override` AdminAction verb — administrative by
  // the product's own classification, so it needs the matching role check.
  const { atLeast } = await import("@/lib/auth");
  if (!atLeast(caller.role, "admin")) {
    return NextResponse.json({ error: "Only an admin can override a verdict." }, { status: 403 });
  }
  const { orgHasFeature } = await import("@/lib/planGate");
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Evals require Growth plan or above." }, { status: 403 });
  }

  let body: { eval_run_a_id?: string; eval_run_b_id?: string; item_id?: string; winner?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { eval_run_a_id, eval_run_b_id, item_id, winner } = body;
  if (!eval_run_a_id || !eval_run_b_id || !item_id || !WINNERS.includes(winner as typeof WINNERS[number])) {
    return NextResponse.json({ error: "eval_run_a_id, eval_run_b_id, item_id, and a valid winner (a/b/tie) are required" }, { status: 400 });
  }

  const { data: runs } = await db().from("ad_eval_runs").select("id,org_id").in("id", [eval_run_a_id, eval_run_b_id]);
  const rows = (runs ?? []) as { id: string; org_id: string | null }[];
  if (!rows.every((r) => r.org_id === caller.orgId) || rows.length !== 2) {
    return NextResponse.json({ error: "Eval not found" }, { status: 404 });
  }

  // The item must actually have been scored in BOTH runs — otherwise a
  // verdict could be set for something that was never compared, inflating
  // summarizePairwise's "compared" count beyond what listPairwiseItems ever
  // shows in the UI.
  const { data: scored } = await db()
    .from("ad_eval_scores")
    .select("eval_run_id")
    .eq("item_id", item_id)
    .in("eval_run_id", [eval_run_a_id, eval_run_b_id]);
  const scoredRuns = new Set(((scored ?? []) as { eval_run_id: string }[]).map((r) => r.eval_run_id));
  if (!scoredRuns.has(eval_run_a_id) || !scoredRuns.has(eval_run_b_id)) {
    return NextResponse.json({ error: "This item wasn't scored in both evals." }, { status: 400 });
  }

  try {
    await setHumanVerdict(caller.orgId, eval_run_a_id, eval_run_b_id, item_id, winner as "a" | "b" | "tie", {
      kind: caller.via === "api_key" ? "api_key" : "user",
      userId: caller.userId,
      email: caller.email,
    });
  } catch (e) {
    console.error("pairwise verdict route: setHumanVerdict failed", e);
    return NextResponse.json({ error: "Could not save the override — try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
