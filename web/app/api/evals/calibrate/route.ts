import { NextRequest, NextResponse } from "next/server";
import { orgHasFeature } from "@/lib/planGate";
import { submitReview } from "@/lib/eval/calibration";

export const runtime = "nodejs";

/** A human (or CI, correcting a judge in bulk) agrees with or corrects one verdict. No model call. */
export async function POST(req: NextRequest) {
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  // Calibration writes the `eval.judge_calibrate` AdminAction verb, so the
  // product already classifies this as administrative — the role check was
  // just missing. CI keys resolve to admin, so the documented bulk-correction
  // flow in the docstring above still works.
  const { atLeast } = await import("@/lib/auth");
  if (!atLeast(caller.role, "admin")) {
    return NextResponse.json({ error: "Only an admin can calibrate judge results." }, { status: 403 });
  }
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Evals require Growth plan or above." }, { status: 403 });
  }

  let body: { review_id?: string; human_passed?: boolean; human_note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.review_id || typeof body.human_passed !== "boolean") {
    return NextResponse.json({ error: "review_id and human_passed are required" }, { status: 400 });
  }

  const result = await submitReview(
    caller.orgId,
    body.review_id,
    body.human_passed,
    caller.email,
    body.human_note,
    { kind: caller.via === "api_key" ? "api_key" : "user", userId: caller.userId, email: caller.email }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}
