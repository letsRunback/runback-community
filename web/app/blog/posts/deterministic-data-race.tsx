import Link from "next/link";
import CodeBlock from "@/components/site/CodeBlock";

function RaceDiagram() {
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 190" role="img" aria-labelledby="race-diagram-title">
        <title id="race-diagram-title">Two threads racing to increment the same counter</title>
        {/* collision window */}
        <rect x="8" y="16" width="230" height="150" rx="8" fill="rgba(244,63,94,0.07)" stroke="rgba(244,63,94,0.25)" strokeDasharray="3 3" />
        <text x="123" y="10" textAnchor="middle" fontSize="10" fontFamily="var(--mono)" fill="var(--rose)">
          both threads hold counter=5
        </text>

        {/* Thread A lane */}
        <text x="8" y="52" fontSize="11" fontFamily="var(--mono)" fill="var(--text-muted)">thread A</text>
        <circle cx="40" cy="70" r="16" fill="none" stroke="var(--brand)" strokeWidth="1.5" />
        <text x="40" y="74" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-primary)">read 5</text>
        <path d="M56 70 H140" stroke="var(--border)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="170" cy="70" r="16" fill="none" stroke="var(--brand)" strokeWidth="1.5" />
        <text x="170" y="74" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-primary)">+1 = 6</text>
        <path d="M186 70 H370" stroke="var(--border)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="400" cy="70" r="18" fill="none" stroke="var(--rose)" strokeWidth="1.5" />
        <text x="400" y="74" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--rose)">write 6</text>

        {/* Thread B lane */}
        <text x="8" y="122" fontSize="11" fontFamily="var(--mono)" fill="var(--text-muted)">thread B</text>
        <circle cx="40" cy="140" r="16" fill="none" stroke="var(--brand-2)" strokeWidth="1.5" />
        <text x="40" y="144" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-primary)">read 5</text>
        <path d="M56 140 H210" stroke="var(--border)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="240" cy="140" r="16" fill="none" stroke="var(--brand-2)" strokeWidth="1.5" />
        <text x="240" y="144" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-primary)">+1 = 6</text>
        <path d="M256 140 H460" stroke="var(--border)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="490" cy="140" r="18" fill="none" stroke="var(--rose)" strokeWidth="1.5" />
        <text x="490" y="144" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--rose)">write 6</text>

        {/* result */}
        <path d="M418 78 L472 132" stroke="var(--rose)" strokeWidth="1" strokeDasharray="2 2" />
        <text x="565" y="108" textAnchor="middle" fontSize="10" fontFamily="var(--mono)" fill="var(--rose)">counter = 6</text>
        <text x="565" y="122" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-muted)">(should be 7)</text>

        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>
      <figcaption className="blog-figcaption">
        Both threads read the counter before either writes back. Thread A&apos;s increment overwrites
        thread B&apos;s — one increment vanishes. Neither thread did anything wrong; the race is in
        the gap between read and write.
      </figcaption>
    </figure>
  );
}

export default function DeterministicDataRace() {
  return (
    <>
      <p className="blog-p">
        A bug that won&apos;t reproduce the second time you run it is the most infuriating property
        of debugging anything concurrent — including AI agents. So before we trusted our replay
        engine with a single customer&apos;s incident, we tried to break its determinism claim on
        the textbook example of a bug that <em>isn&apos;t supposed to reproduce at all</em>: a
        genuine, lock-free data race.
      </p>

      <div className="mk-stats" style={{ margin: "1.6rem 0 2rem" }}>
        <div className="mk-stat">
          <div className="n" data-tone="rose">220, 204, 184</div>
          <div className="l">uncontrolled — a different answer every run, out of 600 possible</div>
        </div>
        <div className="mk-stat">
          <div className="n" data-tone="blue">400, 400, 400</div>
          <div className="l">under our scheduler — identical, three runs in a row</div>
        </div>
      </div>

      <h2 className="blog-h2">The setup</h2>
      <p className="blog-p">
        A racy increment loop across multiple threads, compiled at <code>-O0</code> so the
        increment stays a genuine load/add/store read-modify-write — no compiler optimization
        papering over the race. Run uncontrolled, its final counter value is nondeterministic by
        construction: threads interleave differently every time, so some increments get lost.
      </p>

      <RaceDiagram />

      <p className="blog-p">
        We ran it three times under Runback&apos;s instruction-granularity scheduler — the same
        class of technique rr and Hermit use to serialize threads onto a single deterministic
        timeline — and required two things: the result had to be <strong>identical</strong> across
        all three runs, and it had to show <strong>lost updates</strong> (final count below the
        theoretical max), proving a genuine race actually occurred rather than an accidental full
        serialization.
      </p>

      <h2 className="blog-h2">The result</h2>
      <CodeBlock label="linux/race_test.sh — output">{`plain : counter=220 / 204 / 184  (of 600)   ← real, nondeterministic data race
sched : counter=400 / 400 / 400  (of 600)   ← identical every run, and 400<600 = lost updates

PASS data race reproduced DETERMINISTICALLY — identical result across 3 runs
PASS the result shows lost updates (400 < 600) — a genuine data race, reproduced exactly`}</CodeBlock>
      <p className="blog-p">
        200 of 600 updates — a third of them — vanish into the race, and they vanish the exact same
        way three times in a row. That&apos;s the whole trick: not preventing the race, reproducing
        it, on demand, byte for byte.
      </p>

      <div className="blog-pullquote">
        This runs on every push. If it ever regresses — if run two doesn&apos;t match run one — the
        build goes red, the same way a broken unit test would. Nobody has to remember to check.
      </div>

      <p className="blog-p">
        That&apos;s not a simulation and it&apos;s not cherry-picked — it&apos;s a real data race,
        reproduced exactly, every time, and it runs in our CI (
        <code>linux/race_test.sh</code>, part of the <code>determinism-proof</code> workflow). It&apos;s
        one tier in a deeper stack: libc interposition, ptrace-level syscall interception, a
        deterministic thread scheduler, and instruction-precise preemption via the PMU
        retired-conditional-branch counter, each proven independently and layered to reach this
        result.
      </p>

      <h2 className="blog-h2">So what?</h2>
      <p className="blog-p">
        This isn&apos;t the product — it&apos;s the stress test. But it&apos;s the same determinism
        engine behind Runback&apos;s replay-from-any-step feature. When you replay a captured LLM
        step from a real agent run, you&apos;re trusting that everything around that step held
        still — that the only thing different is the edit you made. If our replay engine can pin
        down something as slippery as a genuine data race, three for three, that&apos;s the
        confidence you&apos;re actually buying when you hit &ldquo;replay.&rdquo;
      </p>
      <p className="blog-p">
        We&apos;d rather prove that in public CI than assert it in a pitch deck — the proof run is
        published at{" "}
        <a href="https://github.com/letsRunback/runback-proofs/actions" target="_blank" rel="noopener noreferrer" className="up-link-blue">github.com/letsRunback/runback-proofs</a>,
        and you can check any sealed record yourself at{" "}
        <Link href="/verify" className="up-link-blue">runback.dev/verify</Link>.
      </p>
    </>
  );
}
