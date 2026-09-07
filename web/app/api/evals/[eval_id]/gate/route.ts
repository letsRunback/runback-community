import { NextResponse } from "next/server";
import { gateEvalSuite } from "@/lib/eval/evalGate";
import { communityEvalGate } from "@/lib/entitlements";

export const runtime = "nodejs";

/**
 * The release-gate verdict for a finished eval, computed from TRUSTED items
 * only (production-captured, or synthetic scenarios a human has approved) —
 * see web/lib/eval/evalGate.ts. Used to block a deploy on an eval that
 * includes unreviewed or rejected adversarial scenarios without silently
 * either passing or failing on their account.
 */
export async function GET(req: Request, { params }: { params: Promise<{ eval_id: string }> }) {
  const { eval_id } = await params;

  // Bearer key as well as session: this is the verdict a CI job polls to decide
  // whether to block a deploy, and CI has no cookie.
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) {
    return NextResponse.json({ error: "Sign in or pass an API key to check a gate." }, { status: 401 });
  }
  const { orgHasFeature } = await import("@/lib/planGate");
  if (!(await orgHasFeature(caller.orgId, "upgrade_gate")) && !communityEvalGate()) {
    return NextResponse.json({ error: "The release gate requires the release-gate plan tier." }, { status: 403 });
  }

  const report = await gateEvalSuite(caller.orgId, eval_id);
  if (!report) {
    return NextResponse.json(
      { error: "No gate report available — the eval may not exist, isn't finished, or the deployment hasn't applied sql/add_adversarial_provenance.sql yet." },
      { status: 404 }
    );
  }
  return NextResponse.json(report);
}
