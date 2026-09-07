import CodeBlock from "@/components/site/CodeBlock";

const STEP_BOXES = [
  { x: 20, label: "search", sub: "web_search" },
  { x: 165, label: "fetch", sub: "fetch_url" },
  { x: 310, label: "compose", sub: "summarize" },
];

function StepFlowDiagram() {
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 130" role="img" aria-labelledby="step-flow-title">
        <title id="step-flow-title">Agent steps: search, fetch, compose, then send fails — edit and replay fixes it</title>

        {STEP_BOXES.map((s) => (
          <g key={s.label}>
            <rect x={s.x} y={30} width={110} height={46} rx={8} fill="none" stroke="var(--brand)" strokeWidth={1.5} />
            <text x={s.x + 55} y={50} textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fill="var(--text-primary)">{s.label}</text>
            <text x={s.x + 55} y={65} textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">{s.sub}</text>
          </g>
        ))}
        <path d="M130 53 H165" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#sf-arrow)" />
        <path d="M275 53 H310" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#sf-arrow)" />
        <path d="M420 53 H455" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#sf-arrow)" />

        {/* send — fails */}
        <rect x={460} y={30} width={110} height={46} rx={8} fill="rgba(244,63,94,0.06)" stroke="var(--rose)" strokeWidth={1.5} />
        <text x={515} y={50} textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fill="var(--rose)">send ✗</text>
        <text x={515} y={65} textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--rose)">SMTP 550</text>

        {/* replay path */}
        <path d="M515 78 V96" stroke="var(--text-muted)" strokeWidth={1.2} strokeDasharray="3 3" />
        <text x={515} y={110} textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">edit address + replay this step</text>

        <defs>
          <marker id="sf-arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>
      <figcaption className="blog-figcaption">
        Three steps succeed; <code>send_email</code> fails on a malformed address baked into the
        original task text. Replay re-issues just that one step — search and fetch don&apos;t
        need to run again.
      </figcaption>
    </figure>
  );
}

export default function TimeTravelReplayWalkthrough() {
  return (
    <>
      <p className="blog-p">
        The usual way to debug an agent failure is to re-run the whole thing and hope it breaks the
        same way twice. That&apos;s slow, it costs real API calls, and half the time the bug
        doesn&apos;t even show up again — the model answered differently, or the search result
        changed. Here&apos;s a small, real agent failing, and what it looks like to fix it without
        any of that.
      </p>

      <div className="mk-stats" style={{ gridTemplateColumns: "1fr", margin: "1.6rem 0 2rem" }}>
        <div className="mk-stat">
          <div className="n" data-tone="blue">1 of 4 steps</div>
          <div className="l">re-run to test the fix — search, fetch, and compose don&apos;t happen again</div>
        </div>
      </div>

      <h2 className="blog-h2">The agent</h2>
      <p className="blog-p">
        <code>research-email-agent</code> is a three-step agent: search the web, read the most
        relevant result, summarize it into an email. It&apos;s instrumented with
        <code> withDebugger()</code> from <code>@runback/sdk</code>, wrapping the model in about
        three lines of code. Its task, deliberately: &ldquo;Research Next.js 16 and email a
        3-sentence summary to jordan[at]example.com.&rdquo;
      </p>
      <p className="blog-p">
        That address isn&apos;t valid — no <code>@</code>, just <code>[at]</code> — and the agent
        doesn&apos;t catch it. It searches, reads, composes the email, calls{" "}
        <code>send_email</code>, and the tool throws:
      </p>
      <CodeBlock label="send_email — thrown error">{`SMTP 550: invalid recipient address "jordan[at]example.com". Expected a valid email like name@domain.com.`}</CodeBlock>

      <StepFlowDiagram />

      <h2 className="blog-h2">Finding it</h2>
      <p className="blog-p">
        Open the run and Runback lands you directly on the step that failed — error-first
        navigation, not &ldquo;scroll until something looks red.&rdquo; The <strong>Context</strong>{" "}
        tab shows exactly what the model saw before it made the bad call: the full task text,
        including the malformed address, sitting right there in the user message. Nothing
        reconstructed after the fact — the literal request payload the model received.
      </p>
      <p className="blog-p">
        Click the failing tool call and a causal link jumps you straight to the LLM step that
        requested it, via the shared <code>tool_call_id</code> — no hunting through a flat list to
        figure out which model call caused which side effect.
      </p>

      <h2 className="blog-h2">Fixing it, without re-running the whole agent</h2>
      <p className="blog-p">
        Switch to the <strong>Replay</strong> tab on that LLM step. The exact captured request is
        already loaded — system prompt, messages, tools, params. Edit the task text to fix the
        address, hit <em>Run edited replay</em>, and Runback re-issues that one step against a real
        model with the correction applied. You see the original response and the new one side by
        side: same context up to that point, one input changed, compare what&apos;s different.
      </p>

      <div className="blog-pullquote">
        No re-running search and fetch. No guessing whether the fix works — you see it work, on the
        exact context that failed, in one click.
      </div>

      <h2 className="blog-h2">So what?</h2>
      <p className="blog-p">
        This was a fake address in a demo scenario. In production, the same failure mode is a tool
        call with a malformed argument nobody caught, a context window that silently dropped a
        field, or a model that ignored an instruction — the kind of bug that&apos;s expensive to
        chase precisely because re-running the whole agent doesn&apos;t reliably reproduce it. Replay
        skips that entirely: you&apos;re not hoping the bug happens again, you&apos;re re-running the
        exact request that already produced it.
      </p>
      <p className="blog-p">
        This exact scenario is seeded as a public, standing demo run — no signup, no setup:{" "}
        <code>runback.dev/runs/demo-email-agent</code>. Open it, click into the failing step, and
        replay it yourself.
      </p>
    </>
  );
}
