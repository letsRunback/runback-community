import CodeBlock from "@/components/site/CodeBlock";

function ProbeDiagram() {
  const total = 12;
  const bad = 7; // 0-indexed candidate #7 is the first bad one
  const probed = [5, 8, 6, 7];
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 130" role="img" aria-labelledby="probe-diagram-title">
        <title id="probe-diagram-title">Twelve candidates, four probes, one culprit found by binary search</title>
        {Array.from({ length: total }).map((_, i) => {
          const x = 20 + i * 50;
          const isBad = i >= bad;
          const order = probed.indexOf(i);
          return (
            <g key={i}>
              <rect
                x={x} y={40} width={38} height={38} rx={6}
                fill={isBad ? "rgba(244,63,94,0.08)" : "rgba(16,185,129,0.06)"}
                stroke={isBad ? "var(--rose)" : "var(--emerald)"}
                strokeWidth={i === bad ? 2 : 1}
              />
              <text x={x + 19} y={64} textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fill="var(--text-secondary)">{i}</text>
              {order !== -1 && (
                <text x={x + 19} y={30} textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">probe {order + 1}</text>
              )}
            </g>
          );
        })}
        <text x="20" y="100" fontSize={10} fontFamily="var(--mono)" fill="var(--emerald)">good</text>
        <text x="590" y="100" fontSize={10} fontFamily="var(--mono)" fill="var(--rose)" textAnchor="end">bad</text>
        <text x="320" y="118" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">culprit = candidate #7 — found in 4 probes, not 12</text>
      </svg>
      <figcaption className="blog-figcaption">
        Each probe halves the remaining range. Twelve candidates need at most four re-executions
        to name the exact one that flipped good to bad — not twelve.
      </figcaption>
    </figure>
  );
}

export default function BisectAModelRegression() {
  return (
    <>
      <p className="blog-p">
        &quot;Somewhere in the last dozen prompt revisions, this agent started approving refunds it
        should have escalated. Which one?&quot; The naive answer is to re-run all twelve, one at a
        time, until you spot the flip. The correct answer is the same one <code>git bisect</code>{" "}
        gives you for a broken commit: binary search the timeline instead of walking it.
      </p>

      <div className="mk-stats" style={{ gridTemplateColumns: "1fr 1fr", margin: "1.6rem 0 2rem" }}>
        <div className="mk-stat">
          <div className="n" data-tone="blue">12 → 4</div>
          <div className="l">candidates in the timeline vs. probes needed to find the regression</div>
        </div>
        <div className="mk-stat">
          <div className="n" data-tone="rose">O(log n)</div>
          <div className="l">re-executions instead of O(n) — the gap widens fast as history grows</div>
        </div>
      </div>

      <h2 className="blog-h2">The contract the search relies on</h2>
      <p className="blog-p">
        Binary search only works if the good→bad transition is monotone — the run is good at the
        start of the range and bad at the end, with no good candidate reappearing after the flip.
        That&apos;s the same assumption <code>git bisect</code> makes about a commit history, and it
        holds for the same reason: a regression is a state change, not a coin flip. Runback&apos;s{" "}
        <code>bisect()</code> takes that contract as given and does nothing you couldn&apos;t verify
        yourself — it just automates the probing.
      </p>

      <ProbeDiagram />

      <CodeBlock label="bisect.ts">{`export async function bisect(
  count: number,
  isGood: (index: number) => boolean | Promise<boolean>,
): Promise<BisectOutcome> {
  let lo = 0, hi = count;
  let firstBad: number | null = null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (await isGood(mid)) lo = mid + 1;   // good -> culprit is to the right
    else { firstBad = mid; hi = mid; }     // bad  -> culprit is here or left
  }
  // firstBad is the regression's exact index, found in ~log2(count) probes
}`}</CodeBlock>

      <p className="blog-p">
        Every probe is a real re-execution — the captured run replayed under that candidate&apos;s
        model or prompt version, with the hybrid replay engine serving every recorded value except
        the one axis under test. That&apos;s what keeps each probe cheap: you&apos;re not re-running
        the whole agent from scratch twelve times, you&apos;re changing one variable and replaying
        the rest.
      </p>

      <div className="blog-pullquote">
        The probe sequence is returned alongside the verdict, not thrown away — &quot;trust the
        binary search&quot; is exactly the kind of claim this product exists to argue against, so
        you can see which four candidates were actually checked and confirm the logic yourself.
      </div>

      <h2 className="blog-h2">Why this matters more as the timeline grows</h2>
      <p className="blog-p">
        At 12 candidates, linear search costs you 12 re-executions in the worst case and bisection
        costs 4 — a meaningful but not dramatic difference. At 1,000 prompt revisions across a
        year of iteration, linear search costs 1,000 and bisection costs 10. The gap is
        logarithmic, so it&apos;s exactly the regressions that have been hiding the longest —
        the ones nobody wants to re-run a thousand times to find — where this matters most.
      </p>
    </>
  );
}
