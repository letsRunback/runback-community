import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { planBadgeText } from "@/lib/plans";
import { listRubrics, listReviews, alignmentScore } from "@/lib/eval/calibration";
import SampleDataEmpty from "../../SampleDataEmpty";
import CalibrationQueue from "./CalibrationQueue";
import GateOverlay from "../../GateOverlay";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

export default async function CalibratePage({ searchParams }: { searchParams: Promise<{ rubric?: string }> }) {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Trial-aware effective plan (session.orgPlan), not the raw orgs.plan column —
  // that column stays "free" for the whole trial, which would deny a trialing org
  // the very features its trial grants.
  const allowed = demo || can(session.orgPlan, "quality");
  const { rubric: rubricParam } = await searchParams;

  // Not entitled → skip the query entirely. There's no illustrative fixture
  // here (unlike other gated pages) because the honest "nothing to review
  // yet" empty state below already carries no real numbers — safe to show
  // as-is under the gate.
  const rubrics = allowed ? await listRubrics(session.orgId) : [];

  const body = (
    <div className="appc">
      <Link href="/app/evals" className="apprun-back mono">← Evals</Link>
      <div className="appc-head">
        <h1 className="appc-h1">Judge calibration</h1>
        <p className="appc-sub">Review real LLM-judge verdicts. Every correction you make is fed back into future judging for the same rubric.</p>
      </div>

      {rubrics.length === 0 ? (
        <SampleDataEmpty
          badge="Calibration · align the judge"
          title="Nothing to review yet."
          lead="Once an eval with an llm_judge scorer runs for real (not demo mode), its verdicts show up here for spot-checking. Agree with the judge, or correct it — corrections are automatically injected into future judge prompts for that rubric."
          points={[
            "Simple % agreement between judge and human — the metric the field actually uses",
            "A correction becomes a few-shot example the judge sees next time",
            "Rubric-scoped, not dataset-scoped — one correction improves every eval that shares it",
          ]}
        />
      ) : (
        <>
          <form method="get" className="md-form">
            <div className="md-field">
              <label className="md-label">Rubric</label>
              <select name="rubric" defaultValue={rubricParam ?? rubrics[0].rubricHash} className="md-select" style={{ minWidth: 320 }}>
                {rubrics.map((r) => (
                  <option key={r.rubricHash} value={r.rubricHash}>
                    {(r.rubricLabel || r.rubricHash.slice(0, 12)).slice(0, 80)} — {r.pending} pending / {r.total} total
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-fill md-submit">View →</button>
          </form>
          <RubricPanel orgId={session.orgId} rubricHash={rubricParam ?? rubrics[0].rubricHash} />
        </>
      )}
    </div>
  );

  if (!allowed) {
    return (
      <GateOverlay
        badge={`Judge calibration · ${planBadgeText("quality")}`}
        title="Trust your LLM judge — or catch it when it's wrong."
        lead="Spot-check real judge verdicts against human review. Every correction becomes a few-shot example fed back into future judging for that rubric."
        ctaHref={UPGRADE_HREF}
        ctaLabel="Upgrade →"
        secondaryHref="/contact?subject=calibration"
        secondaryLabel="Talk to us"
      >
        {body}
      </GateOverlay>
    );
  }

  return body;
}

async function RubricPanel({ orgId, rubricHash }: { orgId: string; rubricHash: string }) {
  const [alignment, pending] = await Promise.all([
    alignmentScore(orgId, rubricHash),
    listReviews(orgId, rubricHash, { pendingOnly: true }),
  ]);

  return (
    <>
      <div className="md-kpi-grid">
        <div className="md-kpi">
          <div className="md-kpi-label">Reviewed</div>
          <div className="md-kpi-val md-kpi-base">{alignment.reviewed}</div>
        </div>
        <div className="md-kpi">
          <div className="md-kpi-label">Agreement</div>
          <div className={`md-kpi-val ${alignment.reviewed === 0 ? "md-kpi-base" : alignment.agreementPct >= 80 ? "md-kpi-emerald" : "md-kpi-amber"}`}>
            {alignment.reviewed === 0 ? "—" : `${alignment.agreementPct}%`}
          </div>
        </div>
        <div className="md-kpi">
          <div className="md-kpi-label">Pending</div>
          <div className="md-kpi-val md-kpi-base">{pending.length}</div>
        </div>
      </div>

      {pending.length === 0 ? (
        <div className="appc-empty">No pending verdicts for this rubric — every recent judge call has been reviewed.</div>
      ) : (
        <CalibrationQueue reviews={pending} />
      )}
    </>
  );
}
