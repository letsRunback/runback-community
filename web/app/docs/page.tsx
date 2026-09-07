import Link from "next/link";
import Image from "next/image";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import PageJourney from "@/components/site/PageJourney";
import DocsNav from "./DocsNav";
import { pageMetadata } from "@/lib/seo";
import { PRICING_HREF } from "@/lib/edition";

export const metadata = pageMetadata({
  path: "/docs",
  title: "Documentation",
  description:
    "Full how-to guide for Runback — quick start, SDK, OpenTelemetry, replay, policies, evals, CI gate, approvals, incidents, trust chain, self-hosting, and API reference.",
});

// Same reasoning as page.tsx (home) and login/page.tsx: RUNBACK_SELF_HOSTED is
// only present in the running container's environment (docker-compose), not
// at `docker build` time, so without force-dynamic this page's `selfHosted`
// read gets baked in as `false` forever by static prerendering — one of the
// few pages the self-host gate deliberately leaves reachable then renders a
// header/footer full of marketing links that 307-redirect back to /login.
export const dynamic = "force-dynamic";

function Section({ id, title, tier, children }: { id: string; title: string; tier?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="docs-section">
      <div className="docs-section-head">
        <h2 className="docs-h2">
          {/*
            This anchor's entire accessible name was "#". With 43 sections, a
            screen-reader user navigating by link heard "hash" 43 times, and
            every heading announced as "number sign <title>". aria-hidden plus
            tabindex -1 keeps the visual affordance and takes it out of both the
            link list and the tab order; the heading text is the real target.
          */}
          <a href={`#${id}`} className="docs-anchor" aria-hidden="true" tabIndex={-1}>#</a>
          {title}
        </h2>
        {tier && <span className={`docs-tier docs-tier-${tier.toLowerCase()}`}>{tier}</span>}
      </div>
      {children}
    </section>
  );
}

function Note({ children, kind = "note" }: { children: React.ReactNode; kind?: "note" | "warning" | "tip" }) {
  return <div className={`docs-callout docs-callout-${kind}`}>{children}</div>;
}

function Code({ lang, children }: { lang?: string; children: string }) {
  return (
    <div className="docs-code-block">
      {lang && <div className="docs-code-lang mono">{lang}</div>}
      <pre className="docs-code"><code>{children.trim()}</code></pre>
    </div>
  );
}

function Screen({ src, label }: { src: string; label: string }) {
  return (
    <div className="docs-screen">
      <div className="docs-screen-chrome">
        <div className="docs-screen-chrome-dots"><span /><span /><span /></div>
        <span className="docs-screen-label">runback.dev/app — {label}</span>
      </div>
      <Image src={src} alt={label} width={1280} height={800} style={{ width: "100%", height: "auto", display: "block" }} />
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">
        <thead>
          <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell === "✓" ? <span className="cmp-y">✓</span> : cell === "—" ? <span className="cmp-n">—</span> : cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OTEL_ENV = `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://runback.dev/api/otel/v1/traces
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer <RUNBACK_API_KEY>`;

export default function Docs() {
  // RUNBACK_SELF_HOSTED is always set by docker-compose.yml, never on hosted
  // runback.dev — see proxy.ts, which is what makes every other marketing
  // link in Header/Footer a dead end on a self-hosted deployment.
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
  return (
    <>
      <Header selfHosted={selfHosted} />
      <div className="docs-layout">
        <DocsNav selfHosted={selfHosted} />

        <main className="docs-main">
          {/* PAGE HEADER */}
          <div className="docs-page-header">
            <div className="docs-breadcrumb mono">Runback / Documentation</div>
            <h1 className="docs-h1">Documentation</h1>
            <p className="docs-lead">
              Everything you need to instrument an agent, replay an incident, write a policy, and ship with confidence.
              Covers all editions — Community (free), Starter, Growth, Scale, Pro, and Enterprise.
            </p>
            <div className="docs-tier-legend">
              Tier badges mark which edition a feature requires.{" "}
              {selfHosted ? null : <Link href={PRICING_HREF} className="mk-link">See pricing →</Link>}
            </div>
          </div>

          <PageJourney
            current="/docs"
            why="Wrapping one agent takes three lines. Here's exactly how — SDK, OpenTelemetry, policies, self-hosting, and the full API."
            next={{ href: "/onboarding", label: "How a team rolls this out" }}
            selfHosted={selfHosted}
          />

          {/* ══ GETTING STARTED ══ */}
          <Section id="overview" title="Overview">
            <p>Runback is an observability and governance platform for AI agents. It captures every LLM call, tool call, and agent step — then lets you re-run any decision from the exact captured context, enforce policies, run regression tests, and export a tamper-evident audit record.</p>
            <Screen src="/dashboard.png" label="Fleet overview dashboard" />
            <p>The platform has five layers:</p>
            <div className="docs-card-row">
              <div className="docs-card">
                <div className="docs-card-k" data-tone="brand">1 · Capture</div>
                <p>Instrument with the Runback SDK or send traces via OpenTelemetry. Every span is stored in a Postgres database you own.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card-k" data-tone="brand2">2 · Replay</div>
                <p>Re-run any step from the exact captured context — tools, retrieval, messages[] held fixed. Root-cause in minutes.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card-k" data-tone="brand">3 · Gate</div>
                <p>Write policies as JSON rules. They evaluate on every run in real time and can gate your CI pipeline.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card-k" data-tone="brand2">4 · Audit</div>
                <p>Any run exports as a signed, re-executable audit record. Deterministic — no model calls required.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card-k" data-tone="brand">5 · Govern</div>
                <p>Approvals, incidents, trust chains, and regulatory mappings for teams operating in regulated environments.</p>
              </div>
            </div>
          </Section>

          <Section id="quickstart" title="Quick start (5 minutes)" tier="Community">
            {selfHosted ? (
              <p>You&apos;re running a self-hosted instance. See <Link href="#self-docker">Docker Compose</Link> below to bring the stack up, then come back here for the SDK.</p>
            ) : (
              <p>The fastest path: the managed hosted tier. You get a live dashboard in under 5 minutes without running any infrastructure.</p>
            )}
            <div className="docs-steps">
              <div className="docs-step">
                <span className="docs-step-n">1</span>
                {selfHosted ? (
                  <div><strong>Create your account</strong> — sign in to your own instance and generate an ingest key under <strong>Settings → API Key (SDK)</strong>. Not running yet? See <Link href="#self-docker">Docker Compose</Link>.</div>
                ) : (
                  <div><strong>Create a free account</strong> — go to <Link href="/get-started">runback.dev/get-started</Link> and enter your work email. You&apos;ll receive a magic link. Once signed in, click <strong>Settings → API Key (SDK)</strong> to generate your ingest key.</div>
                )}
              </div>
              <div className="docs-step">
                <span className="docs-step-n">2</span>
                <div>
                  <strong>Install the SDK</strong>
                  <Code lang="bash">{`npm install @runback/sdk ai

# "ai" is a peer dependency — the snippet in step 3 imports from it, so
# installing @runback/sdk alone fails with ERR_MODULE_NOT_FOUND.
# Not using the Vercel AI SDK? Install just @runback/sdk and see the tip below.

# Prefer zero-install? "Send a run with cURL" and "OpenTelemetry" below both
# work with nothing added to your project.`}</Code>
                  <Note kind="tip">Not on the Vercel AI SDK? Import from <code>@runback/sdk/core</code> and use <code>startRun()</code> — same recording, no <code>ai</code> peer dependency to install. See <Link href="#sdk-manual">Manual recording</Link>.</Note>
                </div>
              </div>
              <div className="docs-step">
                <span className="docs-step-n">3</span>
                <div>
                  <strong>Wrap your model call</strong>
                  <Code lang="typescript">{`import { withDebugger } from "@runback/sdk";
import { generateText, stepCountIs } from "ai";

const dbg = withDebugger(model, {
  runName: "support-agent",
  apiKey: process.env.RUNBACK_API_KEY,
  redact: "standard",
});

const result = await generateText({
  model: dbg.model,
  tools: dbg.tools(myTools),
  stopWhen: stepCountIs(10),
  prompt: userMessage,
});

// finish() resolves with whether the run actually reached Runback.
// Check it — an audit trail you did not confirm is not an audit trail.
const rec = await dbg.finish({ output: result.text, status: "success" });
if (!rec.ok) console.error("[runback] not recorded:", rec.error);`}</Code>
                </div>
              </div>
              <div className="docs-step">
                <span className="docs-step-n">4</span>
                <div>
                  <strong>Point the SDK at Runback, and set your key</strong>
                  <Code lang="bash">{`export RUNBACK_API_KEY=rb_live_your_key_here
export RUNBACK_INGEST_URL=https://runback.dev   # self-hosted? use your own origin`}</Code>
                  <Note kind="warning">
                    <code>RUNBACK_INGEST_URL</code> is required on the managed service. The SDK
                    defaults to <code>http://localhost:3000</code> so that it can never phone home
                    from a self-hosted or air-gapped deployment — which means that without this
                    line your events go to localhost and nothing is recorded.
                  </Note>
                </div>
              </div>
              <div className="docs-step">
                <span className="docs-step-n">5</span>
                <div><strong>Run your agent once</strong> — open your dashboard. The run appears within seconds.</div>
              </div>
            </div>
            <Note kind="tip">
              <strong>Prefer a one-liner?</strong> Use the quickstart script — installs, configures, and sends a synthetic test run:<br />
              <code>curl -fsSL https://runback.dev/api/quickstart | RUNBACK_API_KEY=your_key bash</code>
            </Note>
          </Section>

          <Section id="first-run" title="Your first run">
            <p>Once a run lands in your dashboard you can:</p>
            <ul className="docs-list">
              <li><strong>Click into it</strong> — opens the time-travel debugger. Scrub the slider to any step.</li>
              <li><strong>Switch to Inspect mode</strong> — see the raw request/response for any LLM or tool call.</li>
              <li><strong>Download the audit record</strong> — a signed, re-executable bundle. Verifiable at <Link href="/verify">runback.dev/verify</Link>.</li>
            </ul>
            <Screen src="/runs.png" label="Runs list — every agent decision captured" />
            <Note>The run detail page shows a one-time onboarding guide on first visit. Click <strong>Got it</strong> to dismiss it and access the full debugger.</Note>
          </Section>

          {/* ══ CORE CONCEPTS ══ */}
          <Section id="concepts-runs" title="Runs &amp; spans">
            <p>A <strong>run</strong> is one end-to-end execution of an agent — from the initial prompt to the final output. A <strong>span</strong> is a single step within that run: either an LLM call or a tool call.</p>
            <Table
              headers={["Object", "What it is", "Key fields"]}
              rows={[
                ["Run", "One agent execution", "run_id, name, status, input, output, started_at"],
                ["LLM span", "One model call", "model, messages, response, tokens, latency_ms"],
                ["Tool span", "One tool call", "tool_name, input, output, error, policy_block"],
                ["Audit record", "Signed bundle of all spans", "content_digest, signature, re-executable"],
              ]}
            />
            <Screen src="/run-trace.png" label="Run detail — trace view with policy block" />
            <p>Span IDs are stable — the same span replays identically every time, from the recording. No model call required.</p>
          </Section>

          <Section id="concepts-replay" title="Replay">
            <p>Runback has two kinds of replay:</p>
            <div className="docs-card-row">
              <div className="docs-card">
                <div className="docs-card-k">Time-travel replay</div>
                <p>Rewind any run to any step. The full agent state — every prior tool output, every message in context — is reconstructed from the recording. Deterministic, offline, no model calls.</p>
                <span className="docs-tier docs-tier-community">Community+</span>
              </div>
              <div className="docs-card">
                <div className="docs-card-k">Step replay</div>
                <p>Re-execute a specific LLM call with a different model or prompt. Runback freezes the recorded inputs and makes a fresh call to the model you choose. Use it to bisect which model change caused a regression.</p>
                <span className="docs-tier">Community</span>
              </div>
            </div>
            <Screen src="/run-trace-scroll.png" label="Time-travel replay — scrub any step" />
            <p><strong>Time-travel controls:</strong></p>
            <ul className="docs-list">
              <li>Drag the slider to scrub to any step</li>
              <li><kbd className="key">←</kbd> / <kbd className="key">→</kbd> step backward and forward one span at a time</li>
              <li>Click any span in the transcript to jump directly to that step</li>
              <li>Switch to <strong>Inspect</strong> mode to see the raw request/response JSON for any step</li>
            </ul>
            <p><strong>Step replay is for:</strong></p>
            <ul className="docs-list">
              <li>Verifying that switching to a cheaper model doesn&apos;t change behaviour on historical incidents</li>
              <li>Bisecting which model or prompt change caused a regression</li>
              <li>Building a counterfactual — &ldquo;what would the agent have done if I&apos;d used GPT-4o mini here?&rdquo;</li>
            </ul>
            <Note>
              Bisect compares the model&apos;s DECISION at each candidate — which tool it calls,
              with what arguments — against the recorded run. It does not re-run your tools, so a
              regression caused by a changed tool or environment response, not the model&apos;s
              choice, is outside what this search can find.
            </Note>
          </Section>

          <Section id="concepts-policies" title="Policies">
            <p>A policy is a JSON array of rules evaluated against every run. A rule is either <code>assert</code> (a predicate that must always hold) or <code>require</code> (an antecedent <code>when</code> that, if it fires, makes a consequent <code>then</code> mandatory) — both block the run if violated. Predicates read tool calls, their arguments, and input/output text — never a fuzzy judge, an exact and repeatable verdict.</p>
            <Code lang="json">{`[
  {
    "id": "no-large-disputed-refund",
    "kind": "require",
    "description": "Disputed refunds over $100 must be escalated, not auto-issued",
    "when": {
      "op": "and",
      "all": [
        { "op": "tool_arg", "tool": "issue_refund", "path": "amount", "cmp": "gt", "value": 100 },
        { "op": "input_matches", "pattern": "disputed" }
      ]
    },
    "then": { "op": "tool_called", "tool": "escalate_to_human" }
  }
]`}</Code>
            <Screen src="/policies.png" label="Policies — governance as code" />
            <p><strong>Rule fields:</strong></p>
            <Table
              headers={["Field", "Values", "Description"]}
              rows={[
                ["kind", "require / assert", "require = block the run if triggered. assert = flag a violation but let the run continue."],
                ["on", "tool_call / llm_call / run_end", "Which event type triggers evaluation."],
                ["when", "JSON condition object", "Field path, operator, and value. Supports and / or / not nesting."],
                ["action", "block / flag / alert", "block stops execution. flag records a violation. alert also fires your alert rules."],
              ]}
            />
            <p><strong>Operators:</strong> <code>eq</code>  <code>ne</code>  <code>gt</code>  <code>gte</code>  <code>lt</code>  <code>lte</code>  <code>contains</code>  <code>starts_with</code>  <code>exists</code></p>
            <Note kind="tip">Policies are versioned. Simulate a new policy against your run history before activating it — no live traffic needed.</Note>
            <h3 className="docs-h3">Coverage gaps</h3>
            <p>A deterministic gate only catches what you&apos;ve written a rule for. Coverage-gap analysis answers the honest follow-up question — <em>which tools has nothing written a rule for at all</em> — by scanning the last 90 days of real tool calls and flagging every one that no active rule&apos;s <code>tool_called</code> or <code>tool_arg</code> predicate even names. Not &quot;a rule exists and didn&apos;t fire&quot;: there is nothing that could have blocked a bad call to it, even in principle. Ranked by call volume, so the biggest live blind spot sorts to the top.</p>
            <Screen src="/policy-coverage-gaps.png" label="Coverage gaps — tools nothing is watching, ranked by call volume" />
          </Section>

          <Section id="concepts-evals" title="Evals &amp; CI gate" tier="Community">
            <p>Evals test your agent on a fixed dataset. The CI release gate fails a build if a new model or prompt causes a regression against your golden tests.</p>
            <Screen src="/evals.png" label="Evals — run your agent against a dataset" />
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-n">1</span><div>Create a dataset — a list of input/expected pairs in your dashboard.</div></div>
              <div className="docs-step"><span className="docs-step-n">2</span><div>Run evals via the CLI or API — Runback executes your agent against each input and scores the output.</div></div>
              <div className="docs-step"><span className="docs-step-n">3</span><div>Add the release gate to CI. It fails the build if the eval score drops below your threshold.</div></div>
            </div>
            <Code lang="yaml">{`# .github/workflows/ci.yml
- name: Runback eval gate
  env:
    RUNBACK_API_KEY: \${{ secrets.RUNBACK_API_KEY }}
  run: |
    # Run the eval — this blocks until scoring finishes and returns its id.
    EVAL_ID=$(curl -fsS -X POST https://runback.dev/api/evals \\
      -H "authorization: Bearer $RUNBACK_API_KEY" \\
      -H "content-type: application/json" \\
      -d '{"dataset_id":"YOUR_DATASET_ID"}' | jq -r .eval_id)

    # Ask for the release-gate verdict and fail the build if it did not pass.
    # verdict is "pass" | "warning" | "fail" | "no_data".
    curl -fsS "https://runback.dev/api/evals/$EVAL_ID/gate" \\
      -H "authorization: Bearer $RUNBACK_API_KEY" \\
      | jq -e '.verdict == "pass"'`}</Code>
            <Note kind="tip">The verdict is <code>pass</code>, <code>warning</code>, <code>fail</code>, or <code>no_data</code>, measured against your org&apos;s thresholds over trusted items only — production-captured runs and human-approved scenarios. The gate is most powerful when seeded by production incidents — see <strong>Golden corpus</strong> below.</Note>
          </Section>

          <Section id="concepts-golden" title="Golden corpus" tier="Growth">
            <p>The golden corpus automatically mines your production incident runs into regression tests. Every run that triggered a policy violation or was marked as a failure is surfaced for review and approval as a golden test.</p>
            <Screen src="/golden.png" label="Golden corpus — incidents auto-mined into tests" />
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-n">1</span><div>Runback identifies runs that triggered a policy violation, had a non-zero error count, or were manually flagged.</div></div>
              <div className="docs-step"><span className="docs-step-n">2</span><div>They appear in <strong>Golden</strong> in your dashboard. You inspect, label, and approve (or reject) each candidate.</div></div>
              <div className="docs-step"><span className="docs-step-n">3</span><div>Approved candidates are added to your golden dataset. The CI gate runs against them on every build.</div></div>
              <div className="docs-step"><span className="docs-step-n">4</span><div>Each new incident adds more tests. Coverage compounds without manual effort.</div></div>
            </div>
            <Note kind="tip">Golden tests compound. After 30 days of production usage, most teams have 50–200 real edge-case tests they never had to write.</Note>
            <h3 className="docs-h3">Auto-suggested rules</h3>
            <p>An uncovered incident shouldn&apos;t depend on someone remembering to go write a rule for it. When a still-open golden entry traces back to a specific tool call that threw, Runback drafts a candidate policy rule right there — a starting point for review, never something applied automatically. It&apos;s stated plainly when the draft is blunt: the rule language has no predicate for &quot;only when it errors like this one did,&quot; so the draft blocks every future call to that tool unconditionally until a human narrows it.</p>
            <Screen src="/golden-suggested-rule.png" label="Suggested rule — drafted from an uncovered incident, not yet active" />
          </Section>

          <Section id="concepts-prompts" title="Prompts" tier="Growth">
            <p>A versioned registry for the prompts your agents run — never a string hardcoded in your codebase. Every save is a new immutable version; a label (<code>production</code>, <code>staging</code>, or anything you name) points at the version your agents actually fetch, so you can edit and test without touching what&apos;s live.</p>
            <Screen src="/prompts.png" label="Prompts — versioned templates, movable labels" />
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-n">1</span><div>Write a template — a JSON array of <code>{"{ role, content }"}</code> messages with <code>{"{{variables}}"}</code> — and save it under a name.</div></div>
              <div className="docs-step"><span className="docs-step-n">2</span><div>Test it in the playground against real variable values, and against more than one model side by side, before it ships.</div></div>
              <div className="docs-step"><span className="docs-step-n">3</span><div>Move the <code>production</code> label to the version you approved. Fully audited.</div></div>
            </div>
            <Note kind="tip">Moving the <code>production</code> label requires the admin role, enforced server-side — every other role can save a new version but can&apos;t promote it live.</Note>
          </Section>

          {/* ══ APPROVALS & INCIDENTS ══ */}
          <Section id="approvals" title="Approvals" tier="Starter">
            <p>A human-in-the-loop review queue for high-stakes agent decisions. There&apos;s no policy-rule field that routes a decision here automatically — it&apos;s explicit: your own agent code calls the API at the point you want a human to sign off, typically right before a policy-flagged action would otherwise run.</p>
            <div className="docs-card-row">
              <div className="docs-card">
                <div className="docs-card-k">How it works</div>
                <p>Your call to <code>POST /api/approvals</code> creates a pending approval. Approvers (team members with the <code>approve</code> permission) see it in <strong>Approvals</strong> and can approve or reject with a note. The decision is sealed into the run record.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card-k">The audit trail</div>
                <p>Every approval decision (who decided, when, with what note) is appended to the run&apos;s tamper-evident record. The chain covers both the agent&apos;s decision and the human decision.</p>
              </div>
            </div>
            <Code lang="typescript">{`// Request approval from your own agent code, at the point you want a human decision
POST /api/approvals
{
  "run_id": "run_abc123",
  "policy_name": "no-large-disputed-refund",
  "rule_desc": "Disputed $250 refund — requires senior review"
}

// Get pending approvals
GET /api/approvals?status=pending`}</Code>
            <Note kind="tip">This is a manual integration point, not an automatic one — nothing in Runback watches for a policy violation and calls this for you. Wrap the call around the specific tool calls you want gated.</Note>
            <h3 className="docs-h3">Anomalous — flagged for review</h3>
            <p>Deliberately separate from the deterministic gate above: a statistical-outlier score is a judgment call, and a judgment call should never be the thing that blocks a run. This section scores each tool&apos;s recent calls against that same tool&apos;s own history — a numeric argument more than 3 standard deviations from baseline gets surfaced here, nothing more. No rule matched, nothing was blocked; it&apos;s a review signal, not a verdict. Tools with no policy coverage at all sort first, since an anomaly on a tool nothing else is watching is the bigger gap.</p>
            <Screen src="/anomaly-flagging.png" label="Anomalous — a statistical outlier flagged for human review, not blocked" />
          </Section>

          <Section id="incidents" title="Incidents" tier="Growth">
            <p>An incident is a structured record of an agent failure or policy breach — separate from the run itself. Incidents track status (open → investigating → resolved), timeline, and linked runs.</p>
            <Screen src="/incidents.png" label="Incidents — auto-RCA from a policy block, no log digging" />
            <Table
              headers={["Status", "Meaning"]}
              rows={[
                ["open", "Incident created, not yet assigned or being investigated"],
                ["investigating", "A team member is actively looking into the root cause"],
                ["resolved", "Root cause identified, fix deployed, golden test added"],
              ]}
            />
            <Code lang="typescript">{`// Create an incident from a run
POST /api/incidents
{
  "run_id": "run_abc123",
  "title": "Refund agent bypassed $100 limit",
  "severity": "high"
}

// Update status
PATCH /api/incidents/:id
{ "status": "resolved", "resolution": "Policy updated, golden test enrolled" }`}</Code>
            <p>From any run detail page, use the <strong>Open incident</strong> button to create a linked incident in one click. The incident page shows the full run, the policy violation, the approval history, and the timeline.</p>
          </Section>

          {/* ══ TRUST CHAIN ══ */}
          <Section id="trust-chain" title="Inter-agent trust chain" tier="Pro">
            <p>In multi-agent systems, a subagent receiving instructions from an orchestrator has no cryptographic proof the orchestrator is who it claims to be, or that the scope of the delegation hasn&apos;t been widened in transit. Runback&apos;s trust fabric seals every delegation edge.</p>
            <div className="docs-card-row">
              <div className="docs-card">
                <div className="docs-card-k">Delegation tokens</div>
                <p>Every orchestrator→subagent call produces a signed attestation — Ed25519 wherever this deployment has a keypair configured, the same signature the per-run audit record uses, HMAC-SHA256 fallback otherwise. The signed payload carries the calling agent, called agent, depth, permitted scope, and a hash of the parent attestation.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card-k">Chain verification</div>
                <p>The full chain from root to leaf exports as a signed artifact. POST it to <code>/api/trust/verify</code> — or re-derive the signature yourself against our published key. No Runback account needed.</p>
              </div>
            </div>
            <Code lang="typescript">{`// Issue a delegation token (orchestrator → subagent)
POST /api/trust/chain
{
  "parent_run_id": "run_orchestrator_abc",
  "child_agent": "kyc-subagent",
  "scope": "read:customer",
  "depth": 1
}

// Verify the full chain
POST /api/trust/verify
{
  "chain": [ /* array of attestation tokens */ ]
}

// Response: { valid: true, depth: 2, root: "loan-orchestrator", ... }`}</Code>
            <Note kind="warning">Trust chain signing uses the same key as the audit record: Ed25519 via <code>AUDIT_ED25519_PRIVATE_KEY</code> where configured — asymmetric, independently verifiable offline against the published public key — HMAC-SHA256 via <code>AUDIT_SIGNING_KEY</code> as a fallback. Self-hosted deployments need at least one of the two set.</Note>
          </Section>

          {/* ══ CONNECT YOUR AGENT ══ */}
          <Section id="sdk-vercel" title="Vercel AI SDK" tier="Community">
            <p>The deepest integration — full context capture, in-process PII redaction, step replay, and typed tool wrappers. About 3 lines of change to an existing agent.</p>
            <Code lang="typescript">{`import { withDebugger } from "@runback/sdk";
import { generateText, stepCountIs } from "ai";

// 1. Wrap your model and tools
const dbg = withDebugger(model, {
  runName: "customer-support",
  apiKey: process.env.RUNBACK_API_KEY,
  redact: "standard",      // false | "standard" | "strict"
  tags: { env: "prod" },
});

// 2. Use dbg.model and dbg.tools — drop-in replacements
const result = await generateText({
  model: dbg.model,
  tools: dbg.tools(myTools),
  stopWhen: stepCountIs(10),
  prompt: task,
});

// 3. Finish the run
await dbg.finish({ output: result.text, status: "success" });

// On error:
// await dbg.finish({ status: "error", error: err });`}</Code>
            <p><strong>Redaction levels:</strong></p>
            <Table
              headers={["Level", "What it strips"]}
              rows={[
                ["none", "Nothing — full fidelity capture"],
                ["standard", "Email, SSN, credit card numbers, and API keys/secrets (Anthropic, OpenAI, Groq, Stripe, GitHub, Slack, Google, AWS, JWTs) — high-confidence patterns only"],
                ["strict", "All of standard + phone numbers and IPv4 addresses — noisier patterns, more false positives"],
              ]}
            />
            <Note>
              This is pattern-based redaction, not a names/addresses NER model — it matches
              structured formats (an email shape, a card-number shape), not free text. It will
              not catch a name or street address written in a sentence. For that, pass{" "}
              <code>customPatterns</code> or a full <code>redactor</code> callback in the SDK config.
            </Note>
          </Section>

          <Section id="sdk-manual" title="Manual recording (any agent loop)" tier="Community">
            <p>
              Not on the Vercel AI SDK? <code>startRun()</code> records the same spans from any
              TypeScript or JavaScript agent loop — a raw provider SDK, your own orchestration,
              anything. Nothing is wrapped; you call it where the work happens.
            </p>
            <Code lang="typescript">{`import { startRun } from "@runback/sdk/core";

const run = startRun({ runName: "support-agent", input: task, redact: "standard" });

// Record each model call
run.llm({
  model: { provider: "openai", model_id: "gpt-4o" },
  request: { system: systemPrompt, messages },
  response: { text: completion, finish_reason: "stop" },
  usage: { input_tokens: 412, output_tokens: 88, total_tokens: 500 },
  latencyMs: 940,
});

// …and each tool call
run.tool({ toolName: "lookup_customer", toolCallId: "t1", input, output, latencyMs: 44 });

// Optional: capture intermediate reasoning
run.reasoning("Disputed charge over the limit — escalating");

await run.finish({ output: answer, status: "success" });`}</Code>
            <Note kind="tip">Records produced this way are identical to the wrapped path — same hash chain, same signed audit export, same replay. The only difference is that you choose the call sites.</Note>
          </Section>

          <Section id="sdk-go" title="Go (preview)" tier="Community">
            <p>
              The Go SDK ships in the Community repository at{" "}
              <code>packages/sdk-go</code>. It is <strong>not yet published as a Go
              module</strong> — <code>go get github.com/letsRunback/runback-go</code> will not
              resolve — so vendor it or add a{" "}
              <code>replace github.com/letsRunback/runback-go =&gt; ./packages/sdk-go</code> to
              your <code>go.mod</code> for now. It covers event capture, redaction, and
              ingest — the same manual-recording shape as above, called from a Go agent loop.
              Redaction is on by default (standard tier): emails, SSNs, credit cards, private
              key blocks, and common provider API keys/tokens are scrubbed from event content
              before it&apos;s sent. Every run also gets a real <code>cassette_digest</code>,
              computed the same way as the TS/Python SDKs — checked byte-for-byte against the
              TS implementation in CI.
            </p>
            <Code lang="go">{`import "github.com/letsRunback/runback-go/runback"

run := runback.NewRun(runback.Options{RunName: "support-agent", Input: task})

run.LLM(runback.LlmInput{
    Model:     runback.Model{Provider: "openai", ModelID: "gpt-4o"},
    Request:   runback.LlmRequest{Messages: []runback.ModelMessage{{Role: "user", Content: task}}},
    Response:  runback.LlmResponse{Text: runback.Ptr(completion), FinishReason: runback.Ptr("stop")},
    Usage:     &runback.TokenUsage{InputTokens: 412, OutputTokens: 88, TotalTokens: 500},
    LatencyMs: runback.Ptr(940),
})

run.Tool(runback.ToolInput{ToolName: "lookup_customer", ToolCallID: "t1", Input: input, Output: output})

run.Finish(runback.FinishInput{Output: answer, Status: "success"})`}</Code>
            <Note kind="warning">
              Preview, not full parity with the TS/Python SDKs: the digest proves tamper-evidence,
              but step-by-step replay/bisection of a Go-recorded run isn&apos;t available yet.
              Redaction covers the built-in standard/strict tiers only — custom patterns, key
              allow/deny lists, and a custom redactor callback (all available in the TS/Python
              SDKs) aren&apos;t ported yet.
            </Note>
          </Section>

          <Section id="sdk-otel" title="OpenTelemetry (any framework)" tier="Community">
            <p>Any framework that emits OpenTelemetry GenAI spans works with Runback. Set three environment variables and your traces flow in automatically.</p>
            <Code lang="bash">{OTEL_ENV}</Code>
            <Note>Replace <code>RUNBACK_API_KEY</code> with the key from your dashboard. Self-hosted deployments use your own base URL instead of <code>runback.dev</code>.</Note>
            <Note kind="warning">
              <strong>Redaction on this path runs server-side, not in-process.</strong> The Vercel
              AI SDK and Python/LangGraph collectors redact before anything leaves your process —
              the strongest guarantee. Every OTel-fed integration (this page, Python OpenAI/Anthropic,
              LangChain/LangGraph/CrewAI/LlamaIndex, OpenAI Agents SDK, Google ADK) instead sends raw
              OTLP spans over the network to Runback first, which then applies the same standard-tier
              redaction before storing or displaying anything. If sending unredacted content over the
              wire to us is not acceptable for your data, use a first-party collector instead.
            </Note>
          </Section>

          <Section id="sdk-python" title="Python — OpenAI / Anthropic" tier="Community">
            <p>Use OpenLLMetry (Traceloop) to auto-instrument the official Python SDKs.</p>
            <Code lang="bash">{`pip install traceloop-sdk`}</Code>
            <Code lang="python">{`from traceloop.sdk import Traceloop

Traceloop.init(
    api_endpoint="https://runback.dev/api/otel",
    headers={"authorization": "Bearer " + os.environ["RUNBACK_API_KEY"]},
)

# All openai.chat.completions.create() and
# anthropic.messages.create() calls are now traced.`}</Code>
          </Section>

          <Section id="sdk-langchain" title="LangChain, LangGraph, CrewAI, LlamaIndex" tier="Community">
            <p>Use OpenInference or OpenLLMetry instrumentors, then point the OTLP exporter at Runback via the env vars above.</p>
            <Code lang="bash">{`# LangChain / LangGraph
pip install openinference-instrumentation-langchain opentelemetry-exporter-otlp-proto-http
# LangChainInstrumentor().instrument()

# CrewAI
pip install traceloop-sdk
# Traceloop.init(...) — CrewAI spans flow straight in

# LlamaIndex
pip install openinference-instrumentation-llama-index
# LlamaIndexInstrumentor().instrument()`}</Code>
            <Note>Set the three <code>OTEL_*</code> environment variables in the same shell before running.</Note>
          </Section>

          <Section id="sdk-openai-agents" title="OpenAI Agents SDK" tier="Community">
            <p>The Agents SDK has an official OpenTelemetry instrumentation package that converts its native trace data — agents, tools, generations, guardrails, handoffs — into GenAI semantic-convention spans. Point it at Runback with the same env vars as every other OTel source.</p>
            <Code lang="bash">{`pip install openai-agents opentelemetry-instrumentation-openai-agents-v2`}</Code>
            <Code lang="python">{`from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.openai_agents_v2 import OpenAIAgentsInstrumentor

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))  # reads OTEL_EXPORTER_OTLP_TRACES_* from env
OpenAIAgentsInstrumentor().instrument(tracer_provider=provider)

# Every Runner.run(...) call is now traced — including tool calls and handoffs.`}</Code>
            <Note>Set the three <code>OTEL_*</code> environment variables above first. The exporter reads them automatically — no endpoint/protocol arguments needed in code.</Note>
          </Section>

          <Section id="sdk-google-adk" title="Google Agent Development Kit (ADK)" tier="Community">
            <p>ADK emits standard OTLP spans natively — agent runs, tool calls, and model requests already follow the GenAI semantic conventions. No third-party instrumentor needed, just point the exporter at Runback.</p>
            <Code lang="bash">{OTEL_ENV}</Code>
            <Note>Same three env vars as the generic OpenTelemetry setup above — ADK picks them up through the standard OTel SDK. See <Link href="#sdk-otel">OpenTelemetry (any framework)</Link> for the full variable reference.</Note>
          </Section>

          <Section id="sdk-env" title="Environment variables">
            <Table
              headers={["Variable", "Required", "Description"]}
              rows={[
                ["RUNBACK_API_KEY", "Yes", "Your API key. All keys are prefixed rb_live_."],
                ["RUNBACK_INGEST_URL", "Yes*", "Where the SDK sends events — e.g. https://runback.dev (hosted) or your own origin (self-hosted). Defaults to http://localhost:3000, so *effectively required outside local dev — without it, events silently go nowhere."],
                ["RUNBACK_DEMO_MODE", "No", "Set to 1 to disable real model calls in replay/evals — used by this site's own public demo, and available on any deployment."],
              ]}
            />
          </Section>

          {/* ══ FEATURES ══
              Time-travel replay and Step replay used to be full sections
              here too, duplicating what Core Concepts → Replay already
              covers — merged there instead of explained twice. Fleet
              benchmarks (below) had no nav entry at all until this pass. */}
          <Section id="feat-topology" title="Fleet topology &amp; benchmarks" tier="Scale">
            <p>The <strong>Topology</strong> view renders your entire agent fleet as a live DAG — orchestrators at the top, subagents and tools at the leaves. Each node shows its call volume, error rate, and token spend. Click a node to drill into its runs.</p>
            <p>Use topology to:</p>
            <ul className="docs-list">
              <li>Identify which subagent is the source of a systemic failure</li>
              <li>Spot unexpected delegation chains (orchestrator calling an agent it shouldn&apos;t)</li>
              <li>See token spend distribution across the fleet at a glance</li>
            </ul>
            <Note kind="tip">Topology updates in real time during a run — watch the flame graph as each agent executes.</Note>
            <h3 className="docs-h3">Fleet benchmarks (Pro+)</h3>
            <p>The <strong>Benchmarks</strong> page compares your fleet&apos;s error rate, latency, and token spend against anonymised aggregate data from peer organisations in the same vertical. Percentile bands (p25, p50, p75, p95) let you see where your fleet stands relative to comparable deployments.</p>
            <Screen src="/benchmark.png" label="Fleet benchmarks — your agents vs. vertical peers" />
            <Table
              headers={["Metric", "What it shows"]}
              rows={[
                ["Error rate", "% of runs ending in error vs. peer p50/p75"],
                ["Latency (p95)", "Your 95th-percentile run duration vs. peer distribution"],
                ["Token spend / run", "Average tokens consumed per run vs. vertical peers"],
                ["Policy block rate", "% of runs blocked by governance rules vs. peer fleet"],
              ]}
            />
            <Note kind="tip">Peer data is anonymised and aggregated — no individual organisation&apos;s data is attributable. Opt-out is available in <strong>Settings → Data sharing</strong>.</Note>
          </Section>

          {/* "Writing policies" used to be a full section here too — it was
              the same rule-fields table and operator list as Core Concepts
              → Policies, just from a slightly different angle. Merged. */}
          <Section id="feat-policy-causes" title="Policy causes" tier="Scale">
            <p>The <strong>Policy causes</strong> page shows a heat map of which policy × agent pairs produce the most blocks. It answers: &ldquo;which agent is firing this rule most, and is it getting better or worse?&rdquo;</p>
            <Table
              headers={["Column", "What it shows"]}
              rows={[
                ["Block rate", "Fraction of runs blocked by this policy/agent pair"],
                ["Trend", "↑ worse / ↓ better vs. prior 30-day window"],
                ["Total blocks", "Absolute count over the selected window"],
              ]}
            />
            <p>The heat map intensifies as block rate increases — zero is transparent, &gt;20% is rose. Use it to identify policies that need rule refinement or agents that need prompt changes.</p>
          </Section>

          <Section id="feat-pii" title="PII redaction" tier="Community">
            <p>On the Vercel AI SDK and Python/LangGraph collectors, redaction runs in-process — inside your application, before any data leaves to Runback; the raw values are never stored anywhere outside your process. Integrations that ship via OpenTelemetry redact server-side instead, after the raw spans reach us — see the note in <Link href="/docs#sdk-otel" className="mk-link" scroll={false}>OpenTelemetry</Link> for which integrations that applies to.</p>
            <p>Standard redaction strips: email addresses, SSNs, credit card numbers, API keys, bearer tokens, and common secret patterns (Anthropic, OpenAI, Groq, Stripe, GitHub, Slack, Google, AWS, JWTs) — high-confidence, format-based matches. Strict adds phone numbers and IPv4 addresses, at the cost of more false positives.</p>
            <p>Redacted values are replaced with a deterministic placeholder like <code>[redacted:email]</code> so the structure of the trace is preserved for replay.</p>
            <p>Every string field is also capped at 50,000 characters (configurable via <code>maxStringLength</code>) before it&apos;s sent — a single oversized tool output or pasted document can&apos;t bloat an ingest payload. A capped field gets a <code>…[truncated: N more chars]</code> marker, and the run&apos;s metadata reports how many fields were capped (<code>truncated_fields</code>) — visible, not silent.</p>
            <Note kind="warning">
              <strong>This is pattern matching, not an NER model.</strong> It catches values that
              look like an email, a card number, or a known secret shape — it does not detect
              names, street addresses, or other free-text PII, and redaction applies to string
              values only. If your agent embeds PII inside structured JSON objects, or needs
              coverage beyond format-based patterns, pass <code>customPatterns</code> or a full{" "}
              <code>redactor</code> callback via the SDK config.
            </Note>
          </Section>

          <Section id="feat-cost" title="Cost attribution &amp; chargeback" tier="Scale">
            <p>The <strong>Cost</strong> page breaks down your AI spend by model and agent over any time window. The <strong>Cost → Teams</strong> view shows spend per team with budget tracking and alert thresholds.</p>
            <Screen src="/cost.png" label="Cost attribution — spend by model and agent" />
            <p>Cost data is derived from captured token counts in every LLM span. No billing integration required.</p>
            <h3 className="docs-h3">Team chargeback (Enterprise)</h3>
            <p>Per-team budget caps and automated alerts when a team approaches or exceeds its monthly cap.</p>
            <Table
              headers={["Feature", "Description"]}
              rows={[
                ["Per-team spend", "Token cost attributed to each team over a rolling 30-day window"],
                ["Budget caps", "Set a monthly spend limit per team; alerts fire at 80% and 100%"],
                ["Overage enforcement", "Optional: block ingest for a team that exceeds its cap until the next month"],
                ["CSV export", "Export the period report for internal billing or departmental chargebacks"],
              ]}
            />
            <p>Configure team budgets under <strong>Settings → Teams → Budget</strong>.</p>
          </Section>

          <Section id="feat-audit" title="Signed audit records" tier="Community">
            <p>Every run can be exported as a signed audit record — a JSON bundle containing all spans, a SHA-256 hash chain over them (each event hashed over the previous, terminating in one <code>content_digest</code>), and a cryptographic signature over that digest. Signed with Ed25519 by default, so it&apos;s verifiable offline by anyone against Runback&apos;s published public key — no shared secret, no account, no trusting Runback&apos;s servers. Self-hosted instances that haven&apos;t set an Ed25519 key fall back to an HMAC-SHA256 signature, verifiable only with your own shared key. (The org-wide ledger those runs seal into separately carries a Merkle root over its checkpoints — see {selfHosted ? "Security" : <Link href="/security">Security</Link>} — a different construction from a single run&apos;s hash chain.) Verifiable independently at <Link href="/verify">runback.dev/verify</Link>.</p>
            <Code lang="bash">{`# Download via API
curl -H "Authorization: Bearer \$RUNBACK_API_KEY" \\
  https://runback.dev/api/runs/{run_id}/audit > audit.json

# Verify locally
npx @runback/verify audit.json`}</Code>
          </Section>

          <Section id="feat-regulatory" title="Regulatory dashboard &amp; compliance export" tier="Enterprise">
            <p>The <strong>Regulatory</strong> page maps your live run data to framework controls — EU AI Act Annex III, APRA CPS 230, and NIST AI RMF. Each control shows whether it&apos;s satisfied, partially covered, or missing evidence, based on your actual captures.</p>
            <Table
              headers={["Framework", "Controls mapped"]}
              rows={[
                ["EU AI Act Art. 12", "Logging and traceability — tamper-evident decision record"],
                ["APRA CPS 230", "Operational risk, continuous monitoring, incident management"],
                ["NIST AI RMF", "Govern, Map, Measure, Manage — live status per function"],
                ["ISO/IEC 42001", "AI management system — evidence export for auditors"],
              ]}
            />
            <h3 className="docs-h3">Compliance export</h3>
            <p>The <strong>Compliance</strong> export generates a structured evidence package for auditor and regulator submissions — a signed, time-stamped summary of your governance posture, not a self-assessment. It includes:</p>
            <ul className="docs-list">
              <li>Policy inventory: all active rules, their versions, and block/flag counts over the audit period</li>
              <li>Incident log: every opened incident, its resolution, and the run record it links to</li>
              <li>Model change history: every model upgrade event and the CI gate result that preceded it</li>
              <li>Merkle-rooted ledger checkpoint: proof that the audit period record is complete and unaltered</li>
            </ul>
            <Note>Both the dashboard and the export are evidence support — neither is a compliance certificate. Your legal or compliance team must assess whether the evidence satisfies your specific obligations.</Note>
          </Section>

          <Section id="feat-narratives" title="Sealed AI narratives" tier="Enterprise">
            <p>An AI-generated explanation — either a root-cause narrative for a model-diff divergence, or a compliance control&apos;s evidence summary — sealed the moment it&apos;s generated: hash-chained to your org&apos;s prior narratives and signed, with the exact evidence it was generated from pinned by digest. If that evidence changes afterward, re-verification catches it — the explanation is disposable, the proof it wasn&apos;t rewritten is not.</p>
            <Screen src="/compliance-narrative.png" label="Regulatory — sealed compliance narrative, verified against current evidence" />
            <p><strong>Two entry points, one sealing mechanism:</strong></p>
            <ul className="docs-list">
              <li>&ldquo;Explain this&rdquo; on a model-diff divergence (Models → Diff) — a root-cause narrative for why behaviour changed between two models.</li>
              <li>&ldquo;Explain this control&rdquo; on any regulatory control (Regulatory page) — a plain-English summary of that control&apos;s live evidence.</li>
            </ul>
            <Note kind="tip">Every narrative shows its signature algorithm and a live re-verification badge — &ldquo;verified against current evidence&rdquo; or &ldquo;evidence changed since sealed,&rdquo; recomputed on every page load, not cached at generation time.</Note>
          </Section>

          {/* "Team chargeback" and "Compliance export" used to be full
              sections here with no nav entry pointing at either — merged
              into Cost attribution and Regulatory dashboard above,
              respectively, where they're now reachable. */}

          {/* "CI release gate" used to be a full section here too, with a
              second, near-identical CI YAML example — merged into Core
              Concepts → Evals & CI gate above. */}

          {/* Pairwise comparison and judge calibration were two separate
              sections — merged into one, matching how API Reference already
              treats them as a single "Pairwise & calibration" group below.
              "Golden corpus" was a literal second section with that exact
              title — merged into Core Concepts → Golden corpus instead. */}
          <Section id="feat-eval-depth" title="Pairwise comparison &amp; judge calibration" tier="Growth">
            <p><strong>Pairwise comparison</strong> judges two eval runs head-to-head, item by item — not two independent pass/fail scores. For each shared item, an LLM judge picks which output is better (or calls it a tie), with position-bias mitigation (the side order is randomized and un-swapped for storage) so the judge can&apos;t learn to favor &ldquo;A.&rdquo;</p>
            <Screen src="/evals-compare.png" label="Pairwise comparison — judged head-to-head, item by item" />
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-n">1</span><div>Run two evals against the same dataset — different models, different prompt versions, whatever you&apos;re deciding between.</div></div>
              <div className="docs-step"><span className="docs-step-n">2</span><div>Compare them. Runback judges every item both runs share, and shows win rate, loss rate, and ties.</div></div>
              <div className="docs-step"><span className="docs-step-n">3</span><div>Disagree with a verdict? Override it. Human overrides are audited and take precedence over the judge&apos;s call.</div></div>
            </div>
            <Note kind="tip">Re-comparing the same pair is safe and cheap — already-judged items are skipped, so you only pay for the ones a new dataset item added.</Note>
            <h3 className="docs-h3">Judge calibration</h3>
            <p>Spot-check real (non-demo) LLM-judge verdicts against human review. Agree with the judge, or correct it — a correction becomes a few-shot example fed back into that rubric&apos;s future judging, so the judge gets better at exactly the cases it&apos;s been wrong about.</p>
            <Screen src="/evals-calibrate.png" label="Judge calibration — spot-check real judge verdicts as they arrive" />
            <Note kind="tip">Calibration is scoped to the rubric (a hash of its criteria), not the dataset — one correction improves every eval that shares that rubric, not just the one it came from.</Note>
          </Section>

          <Section id="feat-corpus-miner" title="Auto-mined adversarial tests" tier="Scale">
            <p>A daily job goes further than mining the literal failure: it takes each real policy block or low-scoring eval and asks a model to probe the same weak spot from a <em>different</em> angle — a new phrasing, not the identical input — so your test suite covers the failure mode your production traffic actually found, not just the one exact case.</p>
            <Screen src="/auto-mined-corpus.png" label="Datasets — Auto-mined failures, proposed from real production failures" />
            <p>Candidates land in an <strong>&ldquo;Auto-mined failures&rdquo;</strong> dataset as <code>pending</code> items — never auto-approved. Review and approve each one in Datasets before it affects your release gate, same as any golden test.</p>
            <Note kind="tip">Capped at 5 highest-severity signals per org per run, so an incident spike can&apos;t flood your review queue. Each signal is mined once — a re-run of the job never proposes the same failure twice.</Note>
          </Section>

          <Section id="feat-security-findings" title="External security findings" tier="Enterprise">
            <p>A narrowly-scoped, write-only key lets a guardrail vendor — Lakera, Cisco AI Defense, or similar — post findings about your runs into your own sealed record instead of staying siloed in their dashboard. Each finding is hash-chained and signed on arrival, independently of your run&apos;s own oracle chain, so a vendor&apos;s webhook can never retroactively alter a run&apos;s replay identity.</p>
            <Screen src="/run-security-finding.png" label="Run detail — a sealed external security finding, surfaced in the header" />
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-n">1</span><div>Generate a security-findings key under <strong>Settings → Security Findings Key</strong>.</div></div>
              <div className="docs-step"><span className="docs-step-n">2</span><div>Paste it into your guardrail vendor&apos;s outbound-webhook config, pointed at <code>POST /api/security-findings</code>.</div></div>
              <div className="docs-step"><span className="docs-step-n">3</span><div>Findings tied to a <code>run_id</code> show up as a pill in that run&apos;s header — everything else lives in the run&apos;s sealed record.</div></div>
            </div>
            <Note kind="warning">This key can only ever POST a finding. It cannot ingest runs, read run content, or open a dashboard session — pasting it into a vendor config leaks nothing beyond that one write.</Note>
          </Section>

          <Section id="feat-external-grants" title="External auditor & regulator grants" tier="Enterprise">
            <p>Issue a read-only, time-limited key scoped to specific runs — or all of them — and hand it to an auditor or regulator instead of a login. It downloads the exact same signed audit record your own team would see: byte-identical, not a summary.</p>
            <Screen src="/security-findings-and-grants.png" label="Settings — issuing an external grant, scoped to specific runs" />
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-n">1</span><div>Under <strong>Settings → External Grants</strong>, label the grant, choose specific runs or all of them, and set an expiry.</div></div>
              <div className="docs-step"><span className="docs-step-n">2</span><div>Hand the raw key to the auditor — it authenticates as a Bearer token on the run&apos;s audit endpoint, nowhere else.</div></div>
              <div className="docs-step"><span className="docs-step-n">3</span><div>Revoke it any time from the same screen. Every grant is checked for expiry and revocation on every read, not just at issuance.</div></div>
            </div>
          </Section>

          {/* ══ SELF-HOSTING ══ */}
          <Section id="self-requirements" title="Requirements" tier="Community">
            <p>Runback is a standard Next.js app backed by a Postgres database. No exotic infrastructure.</p>
            <Table
              headers={["Component", "Minimum", "Recommended"]}
              rows={[
                ["Node.js", "20 LTS", "22 LTS"],
                ["Postgres", "14", "16 (Supabase, RDS, Cloud SQL)"],
                ["RAM", "512 MB", "2 GB"],
                ["CPU", "1 vCPU", "2 vCPU"],
                ["Disk", "10 GB", "50 GB (depends on run volume)"],
              ]}
            />
            <Note>For production self-hosting, use a managed Postgres service. SQLite is not supported.</Note>
          </Section>

          <Section id="self-docker" title="Docker Compose" tier="Community">
            <p>The fastest self-host path. Spins up the app and a local Postgres in two commands.</p>
            <Code lang="bash">{`# 1. Clone the Community edition. Public, source-available, no request needed.
git clone https://github.com/letsRunback/runback-community.git
cd runback-community

# 2. Copy and fill in the env file (set AUDIT_SIGNING_KEY and JWT_SECRET at minimum)
cp .env.example .env && $EDITOR .env

# 3. Start
docker compose up -d

# App is now at http://localhost:3000`}</Code>
            <p>Postgres is bundled — no external database required. For production, override <code>POSTGRES_PASSWORD</code> in <code>.env</code> and point <code>NEXT_PUBLIC_APP_URL</code> at your domain.</p>
            <Note>A <code>scheduler</code> service comes up alongside <code>web</code> and runs the same 18 background jobs the hosted deployment runs on Vercel Cron (ledger sealing, retention, drift alerts, the <code>guard</code> kill-switch, …) — nothing extra to configure. <code>docker compose logs -f scheduler</code> shows each run.</Note>
          </Section>

          <Section id="self-env" title="Environment variables (self-hosted)" tier="Community">
            <Table
              headers={["Variable", "Required", "Description"]}
              rows={[
                ["AUDIT_SIGNING_KEY", "Yes", "HMAC key for tamper-evident audit records. Generate: openssl rand -hex 32"],
                ["AUDIT_ED25519_PRIVATE_KEY", "Recommended", "Ed25519 key so audit records are verifiable offline by anyone, with no shared secret. Falls back to HMAC (not independently verifiable) if unset. Generate: openssl genpkey -algorithm ed25519"],
                ["JWT_SECRET", "Yes", "Signs PostgREST session tokens. Generate: openssl rand -hex 32. Also activates database-enforced tenant isolation (Postgres RLS) as a defense-in-depth layer under the app's own org filtering — docker-compose.yml passes it through as SUPABASE_JWT_SECRET automatically, nothing extra to set."],
                ["POSTGRES_PASSWORD", "Yes", "Postgres password. No default — must be set in .env before docker compose up."],
                ["AUTHENTICATOR_PASSWORD", "Yes", "PostgREST's own DB role password, separate from POSTGRES_PASSWORD. docker compose up hard-fails without it. Generate: openssl rand -hex 32"],
                ["SUPABASE_SERVICE_ROLE_KEY", "Yes", "PostgREST service-role JWT, signed with JWT_SECRET. docker compose up hard-fails without it — see .env.example for the one-line generation command."],
                ["CRON_SECRET", "Yes", "Bearer token the bundled scheduler service presents to the 18 scheduled jobs (retention, ledger sealing, drift, billing reconcile, newsletter, …) — see docs/SELF_HOSTING.md's \"Scheduled jobs\" section. docker compose up hard-fails without it. Generate: openssl rand -hex 32"],
                ["NEXT_PUBLIC_APP_URL", "Yes", "Your public base URL, used for magic-link emails, webhooks, and redirects. docker compose up hard-fails without it — e.g. http://localhost:3000 or https://runback.yourco.com"],
                ["RUNBACK_LICENSE", "Enterprise", "License key for Enterprise features (SSO, fleet dashboard, etc.)."],
                ["RUNBACK_ALLOW_PRIVATE_TARGETS", "No", "Reaching a private/RFC1918 SSO issuer, alert webhook, or SIEM collector is allowed by default self-hosted — nothing to set. Set to false only to opt into the stricter, hosted-style SSRF guard anyway. Always ignored on the hosted service."],
                ["RUNBACK_TSA_URLS", "No", "Internal RFC 3161 timestamp authority for a genuinely air-gapped deployment. Unset, ledger checkpoints are witnessed by two public authorities (freetsa.org, digicert) over the open internet — see Privacy posture in the self-hosting guide."],
                ["RUNBACK_DEMO_MODE", "No", "Set to 1 to disable real model calls in replay/evals."],
                ["RESEND_API_KEY", "No", "Resend API key for magic-link email auth."],
                ["OPENAI_API_KEY", "No", "Only needed for live step-replay & LLM eval judges."],
              ]}
            />
          </Section>

          <Section id="self-upgrade" title="Upgrading" tier="Community">
            <p>SQL migrations run automatically on startup — no manual steps required.</p>
            <Code lang="bash">{`# Docker Compose
docker compose pull
docker compose up -d

# Migrations run automatically on boot.
# Downtime: typically under 5 seconds for minor releases.`}</Code>
            <Note kind="warning">Before upgrading across a major version, read the release notes — major versions may include breaking schema changes that require a one-time migration step.</Note>
          </Section>

          {/* ══ API REFERENCE ══ */}
          <Section id="api-auth" title="Authentication">
            <p>All API requests require a Bearer token in the <code>Authorization</code> header.</p>
            <Code lang="bash">{`curl -H "Authorization: Bearer rb_live_your_key" \\
  https://runback.dev/api/runs`}</Code>
            <p>API keys are created in your dashboard under <strong>Settings → API Key (SDK)</strong>. Keys are prefixed <code>rb_live_</code>.</p>

            {/* "How do I rotate a key" is the first question in every security
                review, and the string "rotat" did not appear anywhere in these
                docs. */}
            <h3 className="docs-h3">Rotating a key</h3>
            <p>
              Keys are stored as SHA-256 hashes — we cannot show you an existing key again, only
              replace it. To rotate:
            </p>
            <ol className="docs-list">
              <li>Go to <strong>Settings → API Key (SDK)</strong> and issue a new key. The raw value is shown once.</li>
              <li>Deploy it to your agents as <code>RUNBACK_API_KEY</code>. Both keys work during the changeover, so there is no ingest gap.</li>
              <li>Revoke the old key from the same screen once no agent is using it.</li>
            </ol>
            <Note>
              Issuance and revocation are both written to the administrative audit log with the
              actor, source IP and timestamp — see {selfHosted ? "Security" : <Link href="/security" className="mk-link">Security</Link>}.
              If a key is leaked, revoke first and rotate second: revocation takes effect on the
              next request, and an ingest gap is cheaper than an open credential.
            </Note>
            <p>
              Two scopes, chosen when you create the key. A <strong>telemetry-only</strong>
              key (the recommended option) can post runs and nothing else — it cannot read run
              content, so a leak cannot exfiltrate your traces. A <strong>full-access</strong>
              key drives the Bearer flows documented below — the CI gate, replay, and the read
              endpoints — and therefore CAN read run content, so treat it like a password and
              prefer telemetry-only wherever those flows are not needed. Compliance-read
              (<code>rb_comp_</code>) and SCIM (<code>rb_scim_</code>) keys are separate scopes
              and rotate the same way.
            </p>
          </Section>

          <Section id="api-runs" title="Runs API">
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["GET", "/api/runs", "List runs. Query params: limit, offset, status, agent_name, from, to."],
                ["GET", "/api/runs/:id", "Get a single run with all spans."],
                ["POST", "/api/runs/:id/replay", "Trigger a step replay. Body: { span_id, model }."],
                ["GET", "/api/runs/:id/audit", "Download the signed audit record as JSON."],
                ["GET", "/api/runs/:id/cassette", "Download the re-executable cassette bundle."],
              ]}
            />
            <Code lang="bash">{`# List the last 10 failed runs
curl -H "Authorization: Bearer \$KEY" \\
  "https://runback.dev/api/runs?status=error&limit=10"

# Download audit record
curl -H "Authorization: Bearer \$KEY" \\
  "https://runback.dev/api/runs/run_abc123/audit" > audit.json`}</Code>
          </Section>

          <Section id="api-prompts" title="Prompts API" tier="Growth">
            <p>The one your agent&apos;s backend or CI actually calls: fetch whatever version a label currently points at, with plain HTTP caching so it works identically behind Docker Compose with no extra infra.</p>
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["GET", "/api/prompts/:name?label=production", "Fetch the version a label points at. ETag + Cache-Control: max-age=60, stale-while-revalidate=300."],
                ["GET", "/api/prompts", "List every prompt's latest version in the org."],
                ["POST", "/api/prompts", "Save a new immutable version. Body: { name, template, model, variables?, commit_message? }."],
                ["GET", "/api/prompts/:name/versions", "List every version of one named prompt, newest first."],
                ["GET", "/api/prompts/:name/labels", "List every label currently set and the version it points at."],
                ["POST", "/api/prompts/:name/labels", "Move a label. Body: { label, version }. Moving \"production\" requires admin."],
                ["POST", "/api/prompts/playground", "Render a template with real values and run it against one or more models. Body: { template, variables, values, model, compare_model_ids? }."],
              ]}
            />
            <Code lang="bash">{`# What your agent's backend calls on every invocation
curl -H "Authorization: Bearer \$KEY" \\
  "https://runback.dev/api/prompts/support-agent?label=production"

# Save a new version
curl -X POST -H "Authorization: Bearer \$KEY" -H "content-type: application/json" \\
  https://runback.dev/api/prompts \\
  -d '{"name":"support-agent","template":[{"role":"user","content":"Hi {{name}}"}],"model":{"provider":"anthropic","model_id":"claude-sonnet-4-6"}}'`}</Code>
          </Section>

          <Section id="api-approvals" title="Approvals &amp; Incidents API" tier="Starter">
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["GET", "/api/approvals", "List approvals. Query: status=pending|approved|rejected"],
                ["POST", "/api/approvals", "Create an approval request for a run."],
                ["PATCH", "/api/approvals/:id", "Approve or reject. Body: { decision, note }"],
                ["GET", "/api/incidents", "List incidents. Query: status=open|investigating|resolved"],
                ["POST", "/api/incidents", "Create an incident linked to a run."],
                ["PATCH", "/api/incidents/:id", "Update incident status or resolution."],
              ]}
            />
          </Section>

          <Section id="api-eval-depth" title="Pairwise &amp; calibration API" tier="Growth">
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["POST", "/api/evals/pairwise", "Judge every shared item between two finished eval runs. Body: { eval_run_a_id, eval_run_b_id, randomize_order? }. Safe to re-run — already-judged items are skipped."],
                ["POST", "/api/evals/pairwise/verdict", "A human overrides one item's verdict. Body: { eval_run_a_id, eval_run_b_id, item_id, winner }. winner is a, b, or tie."],
                ["POST", "/api/evals/calibrate", "A human agrees with or corrects one judge verdict. Body: { review_id, human_passed, human_note? }."],
              ]}
            />
          </Section>

          <Section id="api-audit" title="Audit API">
            <p>Audit records are self-contained signed JSON bundles. To verify a record without trusting Runback:</p>
            <Code lang="bash">{`# Verify with the CLI
npx @runback/verify ./audit.json

# Output: OK  root=abc123...  signature=valid  spans=14`}</Code>
            <p>The CLI recomputes the Merkle tree from the raw span data and checks it against the root in the record. On the hosted service, and any self-host with <code>AUDIT_ED25519_PRIVATE_KEY</code> set, the signature is Ed25519 — verifiable against Runback&apos;s published public key, with no shared secret and no account. A self-host that hasn&apos;t set that key falls back to an HMAC-SHA256 signature, verifiable only with your own key.</p>
          </Section>

          <Section id="api-narratives" title="Narratives API" tier="Enterprise">
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["POST", "/api/runs/:run_id/narrative", "Generate and seal a root-cause narrative for a model-diff divergence. Body: { model_a, model_b, window_days? }."],
                ["GET", "/api/runs/:run_id/narrative", "List sealed narratives for this run, each with a live re-verification verdict."],
                ["POST", "/api/regulatory/:framework_id/:control_id/narrative", "Generate and seal a compliance narrative for one control's live evidence."],
                ["GET", "/api/regulatory/:framework_id/:control_id/narrative", "List sealed narratives for this control, each with a live re-verification verdict."],
              ]}
            />
            <Note>Every narrative is chained into the same per-org sequence regardless of subject — a model-diff narrative and a compliance narrative for the same org share one chain.</Note>
          </Section>

          <Section id="api-security-findings" title="Security findings API" tier="Enterprise">
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["POST", "/api/security-findings", "Ingest one finding. Body: { run_id?, span_id?, vendor, rule, severity, verdict, detail, raw_finding }. Authenticated with a security-findings-scoped key, not your ingest key."],
                ["GET", "/api/runs/:run_id/security-findings", "List a run's sealed findings, each with a live re-verification verdict. Session-authenticated."],
              ]}
            />
            <Code lang="bash">{`curl -X POST https://runback.dev/api/security-findings \\
  -H "Authorization: Bearer rb_secfind_your_key" \\
  -H "content-type: application/json" \\
  -d '{
    "run_id": "run_abc123",
    "vendor": "lakera",
    "rule": "prompt-injection-detected",
    "severity": "high",
    "verdict": "flagged",
    "detail": "Detected an embedded instruction overriding the system prompt.",
    "raw_finding": { "score": 0.94 }
  }'`}</Code>
            <Note kind="warning">severity must be one of info/low/medium/high/critical; verdict must be one of flagged/blocked/allowed. A run_id, if provided, must belong to the key&apos;s own org — a forged or cross-org run_id is rejected.</Note>
          </Section>

          <Section id="api-external-grants" title="External grants API" tier="Enterprise">
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["POST", "/api/app/external-grants", "Issue a grant. Body: { label, scope_type: 'run_ids'|'org_wide', run_ids?, expires_in_days }. Session-authenticated, admin+."],
                ["GET", "/api/app/external-grants", "List issued grants for the org — metadata only, never the raw key."],
                ["DELETE", "/api/app/external-grants/:id", "Revoke a grant immediately."],
              ]}
            />
            <p>The raw key returned from issuance authenticates directly on <code>GET /api/runs/:run_id/audit</code> as a Bearer token — no other endpoint accepts it.</p>
          </Section>

          <Section id="api-trust" title="Trust chain API" tier="Pro">
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["POST", "/api/trust/chain", "Issue a delegation token from orchestrator to subagent."],
                ["POST", "/api/trust/verify", "Verify a trust chain. Returns: valid, depth, root, chain."],
              ]}
            />
          </Section>

          <Section id="api-analytics" title="Analytics &amp; reporting API" tier="Pro">
            <p>
              Read-only, org-scoped reports — the same data the dashboard pages render, for
              pulling into your own BI, FinOps, or governance tooling. All accept a Bearer key.
            </p>
            <Table
              headers={["Method", "Path", "Description"]}
              rows={[
                ["GET", "/api/cost/attribution", "Cost by model and agent. Query: days (7–90, default 30)."],
                ["GET", "/api/chargeback", "Per-team cost rollup with budget utilisation. Enterprise."],
                ["GET", "/api/models/attribution", "Per-model run counts, error rate, latency, tokens, trend."],
                ["GET", "/api/models/diff", "Compare two models over your runs. Query: modelA, modelB, days. Omit both to list models."],
                ["GET", "/api/benchmark/fleet", "Your metrics against anonymised fleet and vertical percentiles."],
                ["GET", "/api/policy-causes", "Which policies block which agents, and how often."],
                ["GET", "/api/corpus/signals", "Per-agent anomaly and error-rate signals."],
                ["GET", "/api/golden/report", "Golden-corpus coverage: cases enrolled, approved, blocking."],
                ["GET", "/api/drift/report", "Behavioural drift per agent vs the prior window."],
              ]}
            />
            <Code lang="bash">{`# 30-day cost by model, as JSON
curl -H "Authorization: Bearer \$RUNBACK_API_KEY" \\
  "https://runback.dev/api/cost/attribution?days=30"`}</Code>
            <Note>Each endpoint is gated by the plan its dashboard page requires, and scoped to the key&apos;s org — a key can never read another tenant&apos;s data.</Note>
          </Section>

          <Section id="api-webhooks" title="Webhooks" tier="Starter">
            <p>Runback can POST a JSON payload to any URL when a run ends or a policy is triggered.</p>
            <Table
              headers={["Event", "When it fires"]}
              rows={[
                ["run.completed", "Any run finishes (success or error)"],
                ["run.error", "A run ends with status = error"],
                ["policy.block", "A policy rule fires with action = block"],
                ["policy.flag", "A policy rule fires with action = flag"],
                ["approval.created", "An approval request is created"],
                ["incident.opened", "A new incident is opened"],
              ]}
            />
            <Code lang="json">{`// Example payload — policy.block
{
  "event": "policy.block",
  "run_id": "run_abc123",
  "policy_id": "no-large-disputed-refund",
  "tool": "issue_refund",
  "blocked_at": "2026-07-01T14:22:01Z"
}`}</Code>
            <p>Configure webhooks in your dashboard under <strong>Alerts → Webhooks</strong>. HMAC-SHA256 request signing is enabled by default.</p>
          </Section>

          <Section id="plans-limits" title="Rate limits">
            <Table
              headers={["Limit", "Community", "Starter", "Growth", "Scale", "Pro", "Enterprise"]}
              rows={[
                ["Ingest — spans/sec", "50", "200", "500", "1,000", "2,000", "Custom"],
                ["API reads — req/min", "60", "300", "600", "900", "1,200", "Custom"],
                ["Replay — per hour", "10", "50", "100", "200", "500", "Custom"],
                ["Eval runs — per day", "5", "20", "100", "200", "500", "Custom"],
                ["Audit exports — per day", "10", "50", "200", "500", "1,000", "Custom"],
              ]}
            />
            <Note>Requests over the limit return <code>429 Too Many Requests</code> with a <code>retry-after</code> header. Per-request quota headers (<code>X-RateLimit-*</code>) are not currently sent — this previously said they were on every response, and no code emits them.</Note>
          </Section>
        </main>
      </div>
      <Footer selfHosted={selfHosted} />
    </>
  );
}
