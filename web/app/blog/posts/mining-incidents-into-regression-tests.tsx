import CodeBlock from "@/components/site/CodeBlock";

function FlywheelDiagram() {
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 130" role="img" aria-labelledby="flywheel-diagram-title">
        <title id="flywheel-diagram-title">A production incident becomes a permanent regression test, deduped by signature</title>
        <rect x="16" y="40" width="150" height="54" rx={8} fill="none" stroke="var(--rose)" strokeWidth={1.5} />
        <text x="91" y="62" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--rose)">run fails</text>
        <text x="91" y="78" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">policy block or error</text>

        <path d="M166 67 H231" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#f-arrow)" />

        <rect x="236" y="40" width="150" height="54" rx={8} fill="rgba(232,135,61,0.06)" stroke="var(--brand)" strokeWidth={1.5} />
        <text x="311" y="62" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--brand)">signature computed</text>
        <text x="311" y="78" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">dedup key, not run id</text>

        <path d="M386 67 H451" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#f-arrow)" />

        <rect x="456" y="40" width="168" height="54" rx={8} fill="rgba(16,185,129,0.06)" stroke="var(--emerald)" strokeWidth={1.5} />
        <text x="540" y="62" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--emerald)">golden entry</text>
        <text x="540" y="78" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">re-checked on every suite run</text>

        <path d="M540 94 V104 Q540 116 528 116 H176 Q164 116 164 104 V94" fill="none" stroke="var(--border)" strokeWidth={1.2} strokeDasharray="3 3" />
        <text x="352" y="128" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">next incident with the same signature — no new test, streak continues</text>

        <defs>
          <marker id="f-arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>
      <figcaption className="blog-figcaption">
        A thousand occurrences of the same underlying failure collapse to one test — the corpus
        grows with genuinely new failure modes, not with noise.
      </figcaption>
    </figure>
  );
}

export default function MiningIncidentsIntoRegressionTests() {
  return (
    <>
      <p className="blog-p">
        The standard failure mode for agent regression suites is that nobody writes them. Unit
        tests get written against the happy path someone imagined in advance; the failure that
        actually happens in production — the one your users hit — usually never becomes a test at
        all. It gets fixed, everyone moves on, and the exact same bug quietly comes back three
        prompt revisions later because nothing was checking for it.
      </p>

      <div className="mk-stats" style={{ gridTemplateColumns: "1fr", margin: "1.6rem 0 2rem" }}>
        <div className="mk-stat">
          <div className="n" data-tone="brand">1 signature</div>
          <div className="l">per distinct failure — a thousand identical incidents dedupe to one golden-suite entry</div>
        </div>
      </div>

      <h2 className="blog-h2">The corpus is mined, not written</h2>
      <p className="blog-p">
        When a run finishes with a runtime policy block or an unhandled error, Runback computes a
        signature over the reason and the failing detail and upserts it into the golden suite —
        deduped on <code>(org_id, signature)</code>, so the thousandth occurrence of the same
        failure doesn&apos;t create a thousandth test. It links back to the &quot;Production
        incidents&quot; dataset automatically. Nobody has to remember to write the test; the
        incident writes it.
      </p>

      <FlywheelDiagram />

      <CodeBlock label="golden.ts">{`export async function enrollIfBad(
  orgId: string, runId: string, runName: string,
  events: TraceEvent[], digest: string,
): Promise<void> {
  const bad = detectBad(runName, events);
  if (!bad) return;
  await sb.from("ad_golden").upsert(
    { org_id: orgId, run_id: runId, reason: bad.reason,
      signature: bad.signature, detail: bad.detail,
      baseline_digest: digest, status: "active" },
    { onConflict: "org_id,signature", ignoreDuplicates: true },
  );
}`}</CodeBlock>

      <p className="blog-p">
        Running the suite has two distinct modes. <strong>Integrity mode</strong> re-executes each
        captured incident and checks that it still reproduces its sealed cassette — a pure
        determinism check, no model calls, catching accidental drift in the replay engine itself.{" "}
        <strong>Candidate mode</strong> re-runs each incident against a specific model and reports
        whether the same bad decision <em>recurs</em> or has <em>changed</em> — the direct answer to
        &quot;if I ship this model upgrade, does the incident I already fixed come back?&quot;
      </p>

      <div className="blog-pullquote">
        A streak of good results is a claim that survived N policy revisions, not just N clock
        ticks — the suite tags every run with a snapshot of which policy version was live at the
        time, so &quot;this has passed for three weeks&quot; means something specific.
      </div>

      <h2 className="blog-h2">Why dedup on signature, not run</h2>
      <p className="blog-p">
        Deduping on the run itself would mean the corpus size tracks incident volume, not incident
        variety — a noisy week produces a bloated suite that&apos;s expensive to run and mostly
        redundant. Deduping on signature means the suite grows exactly as fast as your agents
        discover genuinely new ways to fail, which is the only growth rate that makes a regression
        suite worth maintaining instead of worth ignoring.
      </p>
    </>
  );
}
