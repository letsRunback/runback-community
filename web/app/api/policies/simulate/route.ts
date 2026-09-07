import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { simulatePolicyOverRuns } from "@/lib/eval/policySim";
import { assertValidPolicy, type PolicyRule } from "@/lib/eval/policy";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Simulate a candidate policy against the org's recent runs — no model calls. Pro+. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  // Exempt the hosted per-email demo login too, not just RUNBACK_DEMO_MODE —
  // DEMO_MODE is unset in production, so demo@runback.dev would otherwise 403
  // here whenever its org isn't independently entitled.
  if (!DEMO_MODE && !isDemoEmail(session.email) && !await orgHasFeature(session.orgId, "policy_simulation")) {
    return NextResponse.json({ ok: false, error: "Policy simulation requires Scale or above — upgrade to run it." }, { status: 403 });
  }

  const rl = await rateLimit(`policy-sim:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many simulations — give it a moment." }, { status: 429 });

  let body: { rules?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }
  const rules = Array.isArray(body.rules) ? (body.rules as PolicyRule[]) : [];
  if (rules.length === 0) return NextResponse.json({ ok: false, error: "Add at least one rule to simulate." }, { status: 400 });

  // A rule that's valid JSON but the wrong shape (e.g. an "assert" with no
  // "pred") used to reach evaluatePolicy() inside simulatePolicyOverRuns and
  // throw a raw "Cannot read properties of undefined (reading 'op')" straight
  // into the UI — technically correct, meaningless to whoever's staring at
  // the JSON they just typed. assertValidPolicy() is the same check
  // importTemplate() and savePolicy() already run before writing a policy;
  // running it here too gives Simulate a real, actionable message instead.
  try {
    assertValidPolicy({ name: "simulate", rules });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Invalid policy." }, { status: 400 });
  }

  try {
    const result = await simulatePolicyOverRuns(session.orgId, rules, 100);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[api/policies/simulate] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Simulation failed — check your rule syntax and try again." }, { status: 500 });
  }
}
