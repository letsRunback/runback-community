import CodeBlock from "@/components/site/CodeBlock";

function BoundaryDiagram() {
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 150" role="img" aria-labelledby="boundary-diagram-title">
        <title id="boundary-diagram-title">Your code, the wrapLanguageModel capture boundary, and the provider</title>

        <rect x="20" y="45" width="150" height="60" rx="8" fill="none" stroke="var(--text-muted)" strokeWidth={1.2} />
        <text x="95" y="72" textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fill="var(--text-secondary)">your agent</text>
        <text x="95" y="88" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">generateText(...)</text>

        <path d="M170 75 H235" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#b-arrow)" />

        <rect x="240" y="30" width="160" height="90" rx="8" fill="rgba(232,135,61,0.06)" stroke="var(--brand)" strokeWidth={1.5} />
        <text x="320" y="55" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--brand)">wrapGenerate</text>
        <text x="320" y="70" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--brand)">doGenerate boundary</text>
        <text x="320" y="90" textAnchor="middle" fontSize={8} fontFamily="var(--mono)" fill="var(--text-muted)">request fully</text>
        <text x="320" y="102" textAnchor="middle" fontSize={8} fontFamily="var(--mono)" fill="var(--text-muted)">assembled here</text>

        <path d="M400 75 H465" stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#b-arrow)" />

        <rect x="470" y="45" width="150" height="60" rx="8" fill="none" stroke="var(--text-muted)" strokeWidth={1.2} />
        <text x="545" y="72" textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fill="var(--text-secondary)">provider</text>
        <text x="545" y="88" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">OpenAI · Anthropic · ...</text>

        <path d="M320 128 V138" stroke="var(--emerald)" strokeWidth={1.2} />
        <text x="320" y="150" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--emerald)">captured → replayable exactly as sent</text>

        <defs>
          <marker id="b-arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>
      <figcaption className="blog-figcaption">
        Merges and transforms your framework does internally already happened by the time
        <code> doGenerate</code> fires — this is the one point where the request exists as a
        single, complete object before the provider ever sees it.
      </figcaption>
    </figure>
  );
}

export default function ReplayFromStepN() {
  return (
    <>
      <p className="blog-p">
        Here&apos;s the failure mode that makes replay dangerous if you get the capture wrong: you
        reconstruct the prompt from your own logs, replay it, watch the bug disappear, ship the fix
        — and the bug is still there in production. Your reconstruction quietly dropped a tool
        definition, or got a message role wrong, and you just replayed your best guess at the
        request, not the request. The fix worked against a request that never actually happened.
      </p>

      <div className="mk-stats" style={{ gridTemplateColumns: "1fr", margin: "1.6rem 0 2rem" }}>
        <div className="mk-stat">
          <div className="n" data-tone="blue">1 boundary</div>
          <div className="l">where the fully-assembled request exists as a single object — after every merge and transform, before the provider sees it</div>
        </div>
      </div>

      <h2 className="blog-h2">One boundary sees everything</h2>
      <p className="blog-p">
        Runback&apos;s SDK doesn&apos;t log at the call sites in your code. It wraps the model
        itself, at the Vercel AI SDK&apos;s middleware boundary —{" "}
        <code>wrapGenerate</code>&apos;s <code>doGenerate</code> hook. Tool definitions have already
        been merged in by the SDK. System messages have already been concatenated from wherever
        they came from. Message arrays have already been transformed into the provider&apos;s API
        format. That&apos;s the one place, after all of it, where the request exists as a single
        complete object, right before it&apos;s handed to the provider.
      </p>

      <BoundaryDiagram />

      <CodeBlock label="agent.ts">{`const dbg = withDebugger(model, {
  runName: "my-agent",
  input: task,
});

const result = await generateText({
  model: dbg.model,
  tools: dbg.tools(myTools),
  prompt: task,
});`}</CodeBlock>
      <p className="blog-p">
        That&apos;s the whole integration. <code>withDebugger()</code> wraps the model with
        middleware that captures the request at that boundary and the response, usage, and latency
        on the way back — before the request reaches the provider and after the response comes
        back, with nothing reconstructed in between.
      </p>

      <div className="blog-pullquote">
        Because the captured request is the literal object the provider received, replaying it
        means re-issuing exactly that request — not a reconstruction that might have quietly
        dropped a tool definition or gotten a message role wrong.
      </div>

      <h2 className="blog-h2">So what?</h2>
      <p className="blog-p">
        When you edit a message and hit replay, you&apos;re changing one field of the actual
        historical request, not rebuilding an approximation of it from scratch and hoping it
        matches. The fix you see working in the Replay tab is the fix that actually works in
        production, because it ran against the same request, not a lookalike. That&apos;s also what
        keeps the capture layer thin enough to be three lines of integration instead of a rewrite
        of your agent.
      </p>
    </>
  );
}
