import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import { listRuns } from "@/lib/runs";
import { replayModelAllowlist } from "@/lib/replay/runStep";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import GateOverlay from "../../GateOverlay";
import BisectPanel from "./BisectPanel";

export const dynamic = "force-dynamic";

// Same illustrative-glimpse convention as every other gated /app/models page —
// a non-entitled org sees the real UI shape, not an empty box.
const GLIMPSE_RUNS = [{ run_id: "demo-loan-approval-ec66f8", name: "loan-approval-agent" }];

export default async function BisectPage() {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Same gate the API itself enforces (deep_replay) — matching, not
  // duplicating: the API is still the real enforcement point for any
  // direct call, this just avoids showing a working-looking form that
  // 402s on submit.
  const allowed = demo || can(session.orgPlan, "deep_replay");

  const runs = allowed ? await listRuns(30, session.orgId).catch(() => []) : [];
  const runOptions = allowed
    ? runs.map((r) => ({ run_id: r.run_id, name: r.name }))
    : GLIMPSE_RUNS;

  const body = (
    <BisectPanel
      runs={runOptions}
      defaultCandidates={replayModelAllowlist()}
      defaultRunId={runOptions[0]?.run_id}
    />
  );

  return (
    <div className="appc">
      <Link href="/app/models" className="apprun-back mono">← Models</Link>
      <div className="appc-head">
        <h1 className="appc-h1">Bisect</h1>
        <p className="appc-sub">
          Binary-search an ordered candidate list — models, prompt versions, a change
          timeline — for the exact one that introduced a regression. O(log n) probes,
          not O(n), and every probe is recorded as proof of the search path.
        </p>
        <p className="appc-sub" style={{ marginTop: "0.4rem" }}>
          Each probe compares the model&apos;s DECISION at every step — which tool, with what
          arguments — against the recorded run. It does not re-run your tools, so a
          regression caused by a changed tool or environment response (not the model&apos;s
          choice) won&apos;t be found by this search.
        </p>
      </div>

      {runOptions.length === 0 ? (
        <div className="appc-empty">
          No runs yet. Once your agent has a captured run, come back here to bisect it
          against a candidate model list.
        </div>
      ) : allowed ? body : (
        <GateOverlay
          badge={planBadgeText("deep_replay")}
          title="Find the exact change that broke it — in log₂ tries"
          lead="Bisect re-executes a captured run under each candidate — model versions, prompt revisions, a deploy timeline — narrowing in O(log n) probes instead of testing every candidate one by one. Each probe is recorded, so the result is a reproducible search path, not a black-box verdict. It compares the model's decisions, not tool/environment behavior — see the panel below for what that means in practice."
          secondaryHref="/contact"
          secondaryLabel="Talk to us"
        >
          {body}
        </GateOverlay>
      )}
    </div>
  );
}
