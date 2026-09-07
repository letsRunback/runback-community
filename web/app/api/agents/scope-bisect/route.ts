/**
 * Bisect an agent pair's SCOPE-GRANT history, not its model/prompt history.
 *
 * web/app/api/runs/[run_id]/bisect finds which model/prompt revision in an
 * ordered list introduced a regression. This is the same algorithm
 * (packages/replay/src/enterprise/bisect.ts's bisectCandidates — generic over any
 * ordered list + boolean oracle, unchanged) pointed at a different axis:
 * which SCOPE GRANT, across every delegation Runback has attested between
 * these two agents over time, is the one that let an out-of-scope tool call
 * through. The candidates are trust_attestations rows (each a real, signed
 * delegation instance — see lib/trust.ts's attestDelegation), ordered by
 * time; the oracle is whether that instance's scope-violation audit (also
 * lib/trust.ts, auditScopeViolations) found anything out of bounds.
 *
 * Read-only over already-computed audit data — no live re-execution, so
 * (unlike the run-bisect route) this doesn't need deep_replay gating or
 * per-probe rate limiting. Same entitlement as the trust chain itself.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { getAdminClient } from "@/lib/supabase/admin";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { bisectCandidates } from "@runback/replay";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ error: "Not signed in, and no valid API key." }, { status: 401 });

  const demo = DEMO_MODE || isDemoEmail(caller.email);
  if (!demo && !(await orgHasFeature(caller.orgId, "trust_chain"))) {
    return NextResponse.json({ error: "Scope bisection requires a Pro plan or higher." }, { status: 403 });
  }

  const callingAgent = req.nextUrl.searchParams.get("calling_agent");
  const calledAgent = req.nextUrl.searchParams.get("called_agent");
  if (!callingAgent || !calledAgent) {
    return NextResponse.json({ error: "calling_agent and called_agent query params are required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb
    .from("trust_attestations")
    .select("child_run_id,scope,scope_violations,created_at")
    .eq("org_id", caller.orgId)
    .eq("calling_agent", callingAgent)
    .eq("called_agent", calledAgent)
    .not("scope_violations", "is", null) // only edges the scope-audit cron has actually checked
    .order("created_at", { ascending: true })
    .limit(200);

  const rows = (data ?? []) as {
    child_run_id: string;
    scope: string[];
    scope_violations: string[] | null;
    created_at: string;
  }[];

  if (rows.length < 2) {
    return NextResponse.json(
      {
        error:
          "Need at least 2 audited delegation instances between these agents to bisect. " +
          "The scope-audit cron checks non-wildcard-scope edges hourly — try again once more history has accumulated.",
      },
      { status: 422 }
    );
  }

  const result = await bisectCandidates(
    rows,
    (r) => `${r.child_run_id.slice(0, 10)} · ${r.scope.join(",")}`,
    (r) => (r.scope_violations?.length ?? 0) === 0
  );

  return NextResponse.json({
    result,
    demo,
    // Same caveat bisect.ts documents for the model/prompt axis: this
    // assumes the good→bad transition is monotone across the ordered
    // history. Scattered, non-monotone violations still return an answer,
    // but it should be read as "the search path", not a guaranteed culprit.
    note: "Assumes scope violations began at one point and persisted — the same monotonicity bisect always assumes. Check the probe sequence, not just the verdict, if violations look intermittent.",
  });
}
