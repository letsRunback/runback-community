import Link from "next/link";
import CodeBlock from "@/components/site/CodeBlock";

function SimDiagram() {
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 130" role="img" aria-labelledby="sim-diagram-title">
        <title id="sim-diagram-title">A candidate policy evaluated against 100 recorded runs before it ever gates a live call</title>
        <rect x="16" y="38" width="150" height="56" rx={8} fill="none" stroke="var(--text-muted)" strokeWidth={1.2} />
        <text x="91" y="60" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--text-secondary)">candidate rule</text>
        <text x="91" y="76" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">not yet enforced</text>

        <path d="M166 66 H231" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#s-arrow)" />

        <rect x="236" y="20" width="168" height="92" rx={8} fill="rgba(232,135,61,0.06)" stroke="var(--brand)" strokeWidth={1.5} />
        <text x="320" y="42" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--brand)">100 recorded runs</text>
        <text x="320" y="58" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">recorded LLM decisions,</text>
        <text x="320" y="70" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">evaluated in original order</text>
        <text x="320" y="88" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">no model calls, no replay</text>

        <path d="M404 66 H469" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#s-arrow)" />

        <rect x="474" y="38" width="150" height="56" rx={8} fill="rgba(244,63,94,0.06)" stroke="var(--rose)" strokeWidth={1.5} />
        <text x="549" y="60" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--rose)">would-block list</text>
        <text x="549" y="76" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">named runs, not a count</text>

        <defs>
          <marker id="s-arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>
      <figcaption className="blog-figcaption">
        The output names the exact runs a candidate rule would have blocked, not just a
        block-rate percentage — a risk owner can open each one and judge if that&apos;s correct.
      </figcaption>
    </figure>
  );
}

export default function SimulateAPolicyBeforeEnforcingIt() {
  return (
    <>
      <p className="blog-p">
        The usual way a policy rule reaches production is: someone writes it, someone approves it,
        it goes live, and the first time anyone finds out whether it&apos;s too strict or too loose
        is when it blocks — or fails to block — a real call. That feedback loop runs on
        production traffic, which is a bad place to discover your regex was slightly wrong.
      </p>

      <div className="mk-stats" style={{ gridTemplateColumns: "1fr", margin: "1.6rem 0 2rem" }}>
        <div className="mk-stat">
          <div className="n" data-tone="brand">100 runs</div>
          <div className="l">of real recorded history a candidate rule is checked against before it ever gates a live call</div>
        </div>
      </div>

      <h2 className="blog-h2">Evaluate against history, not against the future</h2>
      <p className="blog-p">
        Runback&apos;s policy simulator takes a candidate rule set and replays it — deterministically,
        with no model calls and no re-execution — against the org&apos;s most recent recorded runs.
        Each run&apos;s LLM decisions are evaluated in their original sequence, because a rule that
        accumulates state across tool calls (a running total, say) has to see the calls in the order
        they actually happened to give the same verdict enforcement would have given live.
      </p>

      <SimDiagram />

      <CodeBlock label="policySim.ts">{`export async function simulatePolicyOverRuns(
  orgId: string, rules: PolicyRule[], limit = 100,
): Promise<PolicySimResult> {
  const runs = await recentRuns(orgId, limit);
  const affected: PolicySimRun[] = [];
  for (const run of runs) {
    const decisions = await recordedDecisions(run.run_id);
    const v = wouldBlock(decisions, rules);
    if (v.blocked) affected.push({ run_id: run.run_id, name: run.name, detail: v.detail });
  }
  return { total: runs.length, blocked: affected.length, affected, /* ... */ };
}`}</CodeBlock>

      <p className="blog-p">
        The output isn&apos;t a block-rate number — it&apos;s the actual list of runs the rule would
        have caught, each one a real link you can open and inspect. That distinction matters: a
        block rate tells you a rule is aggressive, but only the named runs let a risk owner check
        whether it&apos;s aggressive <em>correctly</em> — catching the incident it was written for,
        not an unrelated batch of harmless calls that happen to share a keyword.
      </p>

      <div className="blog-pullquote">
        A rule simulated clean against 100 real runs and then enforced live isn&apos;t a guess that
        got lucky — it&apos;s a rule that already survived the exact traffic it&apos;s about to run
        against, just without the ability to actually block anything yet.
      </div>

      <h2 className="blog-h2">Where this fits</h2>
      <p className="blog-p">
        This is the same mechanism behind the &quot;simulate a policy against history, then enforce
        it live&quot; capability described on the{" "}
        <Link href="/vs" style={{ color: "var(--brand)" }}>competitive comparison page</Link> — most
        observability tools can show you a trace after the fact, but none of them let you test a
        not-yet-enforced rule against a real production history before it&apos;s live. Read-only
        tools can&apos;t do this because there&apos;s nothing to simulate against without a real
        recorded decision history to evaluate the candidate rule over.
      </p>
    </>
  );
}
