import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { planBadgeText } from "@/lib/plans";
import { listEvals, type EvalRow } from "@/lib/eval/evals";
import { summarizePairwise, listPairwiseItems, type PairwiseSummary, type PairwiseItemView } from "@/lib/eval/pairwise";
import { diffEvals, type RegressionReport } from "@/lib/eval/regression";
import RunPairwiseButton from "./RunPairwiseButton";
import PairwiseVerdictButtons from "./PairwiseVerdictButtons";
import GateOverlay from "../../GateOverlay";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what a real head-to-head judgment looks like, not an empty picker.
const GLIMPSE_SUMMARY: PairwiseSummary = { compared: 12, aWins: 7, bWins: 3, ties: 2, aWinPct: 58.3, bWinPct: 25.0, tiePct: 16.7, selfJudged: 0 };
const GLIMPSE_ITEMS: PairwiseItemView[] = [
  { item_id: "g1", label: "disputed charge → must escalate", outputA: "Escalating to a human reviewer per policy.", outputB: "I've refunded the charge.", winner: "a", reason: "B skipped the required escalation step.", source: "llm", judgeIsCandidate: false },
];
const GLIMPSE_REGRESSION: RegressionReport = {
  baselineEvalId: "g-a", candidateEvalId: "g-b", compared: 12,
  regressions: [{ item_id: "g1", label: "disputed charge → must escalate" }],
  improvements: [
    { item_id: "g2", label: "refund over policy limit" },
    { item_id: "g3", label: "PII in tool args" },
  ],
  unchanged: 9, onlyInCandidate: 0, gatePassed: false,
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Trial-aware effective plan (session.orgPlan), not the raw orgs.plan column —
  // that column stays "free" for the whole trial, which would deny a trialing org
  // the very features its trial grants.
  const allowed = demo || can(session.orgPlan, "quality");
  const { a, b } = await searchParams;

  let evals: EvalRow[] = [];
  if (allowed) {
    try { evals = await listEvals(session.orgId); } catch { /* db */ }
  }
  const done = evals.filter((e) => e.status === "done");

  const canCompare = allowed && a && b && a !== b && done.some((e) => e.id === a) && done.some((e) => e.id === b);
  const [summary, items, regression] = canCompare
    ? await Promise.all([summarizePairwise(a!, b!), listPairwiseItems(a!, b!), diffEvals(a!, b!).catch(() => null)])
    : allowed ? [null, [], null] : [GLIMPSE_SUMMARY, GLIMPSE_ITEMS, GLIMPSE_REGRESSION];

  const evalName = (id: string) => done.find((e) => e.id === id)?.name ?? (allowed ? "Eval" : "candidate");
  const nameA = allowed ? evalName(a!) : "Model A";
  const nameB = allowed ? evalName(b!) : "Model B";

  const body = (
    <div className="appc">
      <Link href="/app/evals" className="apprun-back mono">← Evals</Link>
      <div className="appc-head">
        <h1 className="appc-h1">Compare</h1>
        <p className="appc-sub">Which of two evals actually produces the better output — item by item, judged head-to-head.</p>
      </div>

      <form method="get" className="md-form">
        <div className="md-field">
          <label className="md-label">Eval A</label>
          <select name="a" defaultValue={a ?? ""} className="md-select">
            <option value="">Select eval</option>
            {done.map((e) => <option key={e.id} value={e.id}>{e.name ?? e.id}</option>)}
          </select>
        </div>
        <span className="md-arrow">→</span>
        <div className="md-field">
          <label className="md-label">Eval B</label>
          <select name="b" defaultValue={b ?? ""} className="md-select">
            <option value="">Select eval</option>
            {done.map((e) => <option key={e.id} value={e.id}>{e.name ?? e.id}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-fill md-submit">Compare →</button>
      </form>

      {allowed && !canCompare && a && b && (
        <div className="appc-empty">Both evals must have finished running before they can be compared.</div>
      )}
      {allowed && !canCompare && !(a && b) && (
        <div className="appc-empty">Select two finished evals above to judge them head-to-head, item by item.</div>
      )}

      {(canCompare || !allowed) && regression && (
        <div className={`regr ${regression.gatePassed ? "ok" : "bad"}`}>
          <div className="regr-head">
            <strong>
              {regression.regressions.length > 0
                ? `✗ ${regression.regressions.length} regression${regression.regressions.length === 1 ? "" : "s"} from ${nameA} to ${nameB}`
                : `✓ No regressions from ${nameA} to ${nameB}`}
            </strong>
            <span className="mono">
              {regression.compared} shared item{regression.compared === 1 ? "" : "s"} · {regression.improvements.length} improved · {regression.unchanged} same
              {regression.onlyInCandidate ? ` · ${regression.onlyInCandidate} only in ${nameB}` : ""}
            </span>
          </div>
          {(regression.regressions.length > 0 || regression.improvements.length > 0) && (
            <ul className="regr-list">
              {regression.regressions.map((r) => (
                <li key={`r-${r.item_id}`}><span className="verdict fail">REGRESSED</span> {r.label ?? r.item_id}</li>
              ))}
              {regression.improvements.map((r) => (
                <li key={`i-${r.item_id}`}><span className="verdict pass">IMPROVED</span> {r.label ?? r.item_id}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(canCompare || !allowed) && summary && (
        <>
          <div className="md-kpi-grid">
            <div className="md-kpi">
              <div className="md-kpi-label">Compared</div>
              <div className="md-kpi-val md-kpi-base">{summary.compared}</div>
            </div>
            <div className="md-kpi">
              <div className="md-kpi-label">{nameA} wins</div>
              <div className="md-kpi-val md-kpi-emerald">{summary.aWins} <span className="mono appc-dim">({summary.aWinPct}%)</span></div>
            </div>
            <div className="md-kpi">
              <div className="md-kpi-label">{nameB} wins</div>
              <div className="md-kpi-val md-kpi-emerald">{summary.bWins} <span className="mono appc-dim">({summary.bWinPct}%)</span></div>
            </div>
            <div className="md-kpi">
              <div className="md-kpi-label">Ties</div>
              <div className="md-kpi-val md-kpi-amber">{summary.ties} <span className="mono appc-dim">({summary.tiePct}%)</span></div>
            </div>
          </div>

          {summary.selfJudged > 0 && (
            <p className="appc-sub" style={{ marginTop: "0.6rem" }}>
              ⚠ {summary.selfJudged} of {summary.compared} verdict{summary.selfJudged === 1 ? "" : "s"} had the judge
              grading an output from its own model — a known self-preference bias. Marked below, not excluded.
            </p>
          )}

          {canCompare && <RunPairwiseButton evalRunAId={a!} evalRunBId={b!} />}

          {items.length === 0 ? (
            <div className="appc-empty">No shared items scored between these two evals.</div>
          ) : (
            <ul className="eval-results">
              {items.map((it) => (
                <li key={it.item_id} className="eval-row">
                  <div className="eval-row-top">
                    <span className="eval-row-label">{it.label ?? it.item_id}</span>
                    {it.winner && (
                      <span className={`pill pill-${it.winner === "tie" ? "muted" : "ok"}`}>
                        {it.winner === "tie" ? "tie" : it.winner === "a" ? `${nameA} wins` : `${nameB} wins`}
                        {it.source === "human" && " · human"}
                      </span>
                    )}
                    {it.judgeIsCandidate && (
                      <span className="pill pill-error" title="The judge model is the same model that produced one of these outputs.">
                        ⚠ judge = candidate
                      </span>
                    )}
                  </div>
                  <div className="replay-compare">
                    <div className="replay-card">
                      <div className="replay-card-head">{nameA}</div>
                      <div className="replay-card-text">{it.outputA?.trim() || "(no content)"}</div>
                    </div>
                    <div className="replay-card" data-accent>
                      <div className="replay-card-head">{nameB}</div>
                      <div className="replay-card-text">{it.outputB?.trim() || "(no content)"}</div>
                    </div>
                  </div>
                  {it.reason && <p className="appc-sub mono" style={{ marginTop: "0.4rem" }}>{it.reason}</p>}
                  {canCompare && (
                    <PairwiseVerdictButtons
                      evalRunAId={a!}
                      evalRunBId={b!}
                      itemId={it.item_id}
                      current={it.winner}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );

  if (!allowed) {
    return (
      <GateOverlay
        badge={`Pairwise comparison · ${planBadgeText("quality")}`}
        title="Which model actually writes the better answer?"
        lead="Judge two eval runs head-to-head, item by item, with position-bias mitigation and a human-override path — not just two independent pass/fail scores."
        ctaHref={UPGRADE_HREF}
        ctaLabel="Upgrade →"
        secondaryHref="/contact?subject=pairwise"
        secondaryLabel="Talk to us"
      >
        {body}
      </GateOverlay>
    );
  }

  return body;
}
