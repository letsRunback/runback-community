import CodeBlock from "@/components/site/CodeBlock";

function RedactDiagram() {
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 190" role="img" aria-labelledby="redact-diagram-title">
        <title id="redact-diagram-title">Raw captured event before and after in-process redaction</title>

        {/* before panel */}
        <rect x="10" y="10" width="270" height="150" rx="8" fill="rgba(244,63,94,0.05)" stroke="var(--rose)" strokeWidth={1.2} />
        <text x="145" y="28" textAnchor="middle" fontSize={9.5} fontFamily="var(--mono)" fill="var(--rose)">captured, unredacted</text>
        <text x="25" y="52" fontSize={9.5} fontFamily="var(--mono)" fill="var(--text-secondary)">{"{ role: \"tool\","}</text>
        <text x="35" y="70" fontSize={9.5} fontFamily="var(--mono)" fill="var(--rose)">{"api_key: \"sk-ant-a1b2...\","}</text>
        <text x="35" y="88" fontSize={9.5} fontFamily="var(--mono)" fill="var(--rose)">{"ssn: \"123-45-6789\","}</text>
        <text x="35" y="106" fontSize={9.5} fontFamily="var(--mono)" fill="var(--text-secondary)">{"model_id: \"gpt-4o\","}</text>
        <text x="35" y="124" fontSize={9.5} fontFamily="var(--mono)" fill="var(--text-secondary)">{"tokens: 842"}</text>
        <text x="25" y="142" fontSize={9.5} fontFamily="var(--mono)" fill="var(--text-secondary)">{"}"}</text>

        <path d="M290 85 H350" stroke="var(--text-muted)" strokeWidth={1.5} markerEnd="url(#rd-arrow)" />
        <text x="320" y="76" textAnchor="middle" fontSize={8} fontFamily="var(--mono)" fill="var(--text-muted)">in-process</text>
        <text x="320" y="102" textAnchor="middle" fontSize={8} fontFamily="var(--mono)" fill="var(--text-muted)">before send</text>

        {/* after panel */}
        <rect x="360" y="10" width="270" height="150" rx="8" fill="rgba(16,185,129,0.05)" stroke="var(--emerald)" strokeWidth={1.2} />
        <text x="495" y="28" textAnchor="middle" fontSize={9.5} fontFamily="var(--mono)" fill="var(--emerald)">sent to Runback</text>
        <text x="375" y="52" fontSize={9.5} fontFamily="var(--mono)" fill="var(--text-secondary)">{"{ role: \"tool\","}</text>
        <text x="385" y="70" fontSize={9.5} fontFamily="var(--mono)" fill="var(--emerald)">{"api_key: \"[redacted]\","}</text>
        <text x="385" y="88" fontSize={9.5} fontFamily="var(--mono)" fill="var(--emerald)">{"ssn: \"[redacted]\","}</text>
        <text x="385" y="106" fontSize={9.5} fontFamily="var(--mono)" fill="var(--text-secondary)">{"model_id: \"gpt-4o\","}</text>
        <text x="385" y="124" fontSize={9.5} fontFamily="var(--mono)" fill="var(--text-secondary)">{"tokens: 842"}</text>
        <text x="375" y="142" fontSize={9.5} fontFamily="var(--mono)" fill="var(--text-secondary)">{"}"}</text>

        <text x="320" y="180" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">
          token counts, latency, model id, and span shape survive — only secrets are touched
        </text>

        <defs>
          <marker id="rd-arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>
      <figcaption className="blog-figcaption">
        Illustrative example — the same detector logic runs on real captured events. Structural
        fields (model id, token counts) pass through untouched so monitoring keeps working.
      </figcaption>
    </figure>
  );
}

export default function RedactBeforeItLeaves() {
  return (
    <>
      <p className="blog-p">
        Turn on debugging capture for an AI agent and you&apos;re capturing everything it saw and
        said — including whatever secrets happened to be sitting in that context. A customer&apos;s
        SSN pasted into a support ticket. An API key sitting in an environment dump the agent read.
        A JWT it fetched from an internal endpoint. Now that&apos;s sitting in your observability
        tool, on a screen your engineers share during a debugging session, unless it never made it
        there in the first place.
      </p>

      <div className="mk-stats" style={{ gridTemplateColumns: "1fr", margin: "1.6rem 0 2rem" }}>
        <div className="mk-stat">
          <div className="n" data-tone="blue">14 built-in detectors</div>
          <div className="l">emails, 8 provider API key formats, JWTs, bearer tokens, private keys, SSNs, card numbers — zero config</div>
        </div>
      </div>

      <RedactDiagram />

      <h2 className="blog-h2">In-process, not in-transit</h2>
      <p className="blog-p">
        <code>@runback/redact</code> is a separate package from the core SDK, and it runs
        <strong> inside your process, before anything is sent anywhere</strong> — not as a
        server-side scrubbing pass after ingest, which would mean the raw secret already left your
        infrastructure. Enable it with one option:
      </p>
      <CodeBlock label="agent.ts">{`withDebugger(model, {
  runName: "my-agent",
  redact: {
    preset: "standard",
    redactKeys: ["x_internal_id"],        // also blank these object keys
    customPatterns: [{ name: "emp", regex: /EMP-\\d{5}/g }],
    allowKeys: ["model_id"],              // never touch these
  },
});`}</CodeBlock>

      <h2 className="blog-h2">What it catches</h2>
      <p className="blog-p">
        The <code>&quot;standard&quot;</code> preset is high-confidence detectors only, tuned to
        avoid false positives on real prose: emails, OpenAI/Anthropic/Groq/Stripe/GitHub/Slack/
        Google/AWS keys, JWTs, bearer tokens, private-key blocks, SSNs, and Luhn-valid credit card
        numbers. <code>&quot;strict&quot;</code> adds phone numbers and IP addresses — noisier, so
        it&apos;s opt-in rather than default.
      </p>
      <p className="blog-p">
        You can extend it: <code>redactKeys</code> blanks specific object keys outright regardless
        of pattern match, <code>customPatterns</code> adds your own regex-based detectors for
        anything domain-specific (an internal employee ID format, say), and <code>allowKeys</code>{" "}
        marks fields that should never be touched even if a pattern would otherwise match.
      </p>

      <div className="blog-pullquote">
        Redaction removes what a human or model shouldn&apos;t see, not the shape of the data an
        observability tool needs to be useful.
      </div>

      <h2 className="blog-h2">So what?</h2>
      <p className="blog-p">
        Token counts, latencies, model ids, and span structure are preserved even after
        redaction — so monitoring, cost attribution, and eval scoring keep working on a redacted
        trace. You don&apos;t have to choose between a debuggable agent and one that doesn&apos;t
        leak. The instrumentation code is three lines. The redaction is one option on top of it.
        Neither requires a third-party service in the loop, and neither requires you to trust that
        secrets got scrubbed somewhere downstream — they never left your process unredacted.
      </p>
    </>
  );
}
