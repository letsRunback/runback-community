import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { getAdminClient } from "@/lib/supabase/admin";
import { getModelDiff } from "@/lib/modelDiff";
import { generateRootCauseNarrative, type ModelDiffNarrativeContext } from "@/lib/eval/narrative";
import { appendNarrative, getNarrativesForRun, verifyStoredNarrative } from "@/lib/narratives";

export const runtime = "nodejs";
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

async function assertOwnedRun(runId: string, orgId: string): Promise<{ org_id: string; cassette_digest: string | null } | null> {
  const { data } = await db()
    .from("ad_runs")
    .select("org_id,cassette_digest")
    .eq("run_id", runId)
    .maybeSingle();
  if (!data?.org_id || data.org_id !== orgId) return null;
  return data;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ run_id: string }> }) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Matches the demo bypass used by every other Enterprise-gated route
  // (compliance/report, regulatory, chargeback, ledger, models/diff, proof, ...).
  const demo = DEMO_MODE || isDemoEmail(session.email);
  const allowed = demo || (await orgHasFeature(session.orgId, "deep_replay"));
  if (!allowed) return NextResponse.json({ error: "Enterprise feature" }, { status: 403 });

  const { run_id } = await params;
  const run = await assertOwnedRun(run_id, session.orgId);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const narratives = await getNarrativesForRun(session.orgId, run_id);
    // Re-verify each narrative against the run's CURRENT cassette digest, same
    // "live re-verification badge" contract as the compliance-control GET
    // (web/app/api/regulatory/[framework_id]/[control_id]/narrative/route.ts)
    // and the security-findings GET
    // (web/app/api/runs/[run_id]/security-findings/route.ts) — docs promise
    // this for "every narrative" and previously this route silently omitted
    // it for model-diff/bisect narratives.
    const withVerification = narratives.map((n) => ({
      ...n,
      verification: verifyStoredNarrative(n, run.cassette_digest ?? undefined),
    }));
    return NextResponse.json({ narratives: withVerification });
  } catch (e) {
    return NextResponse.json({ error: "Fetch failed", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

interface NarrativeRequestBody {
  model_a?: string;
  model_b?: string;
  window_days?: number;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ run_id: string }> }) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const demo = DEMO_MODE || isDemoEmail(session.email);
  const allowed = demo || (await orgHasFeature(session.orgId, "deep_replay"));
  if (!allowed) return NextResponse.json({ error: "Enterprise feature" }, { status: 403 });

  const { run_id } = await params;
  const run = await assertOwnedRun(run_id, session.orgId);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!run.cassette_digest) {
    return NextResponse.json(
      { error: "This run has no cassette digest yet — nothing to seal a narrative against." },
      { status: 400 }
    );
  }

  let body: NarrativeRequestBody;
  try { body = await req.json(); } catch { body = {}; }
  if (!body.model_a || !body.model_b) {
    return NextResponse.json({ error: "model_a and model_b are required" }, { status: 400 });
  }
  const windowDays = body.window_days ?? 30;

  // Pull the same cached-or-live model-diff report the UI is already
  // showing, and find the specific example that concerns this run. Never
  // fabricate a divergence for a run that doesn't have one — a "compliance"
  // -adjacent feature that invents evidence is worse than not shipping it.
  const report = await getModelDiff(session.orgId, body.model_a, body.model_b, windowDays, demo);
  if (!report || report.method !== "counterfactual") {
    return NextResponse.json(
      { error: "No real (counterfactual) divergence data available for this model pair/window — a narrative needs structured divergence data, not just aggregate rates." },
      { status: 400 }
    );
  }
  const example = report.examples.find((e) => e.run_id === run_id);
  if (!example || !example.divergence_category || example.divergence_severity_score == null || !example.divergence_reason || !example.verdict) {
    return NextResponse.json(
      { error: "This run has no structured divergence recorded in the current model-diff report for that pair/window." },
      { status: 404 }
    );
  }

  const ctx: ModelDiffNarrativeContext = {
    agentName: example.agent_name,
    modelA: body.model_a,
    modelB: body.model_b,
    divergenceCategory: example.divergence_category,
    divergenceSeverity: example.divergence_severity_score,
    divergenceReason: example.divergence_reason,
    verdict: example.verdict,
    runId: run_id,
  };

  try {
    const { getOrgKeys } = await import("@/lib/modelKeys");
    const keys = demo ? undefined : await getOrgKeys(session.orgId);
    const generated = await generateRootCauseNarrative(ctx, keys, demo);
    const sealed = await appendNarrative({
      orgId: session.orgId,
      runId: run_id,
      subject: "model_diff",
      subjectRef: `${body.model_a}:${body.model_b}:${windowDays}`,
      contentDigest: run.cassette_digest,
      modelId: generated.modelId,
      prompt: ctx,
      output: { narrative: generated.text },
    });
    return NextResponse.json({ narrative: sealed });
  } catch (e) {
    return NextResponse.json({ error: "Narrative generation failed", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
