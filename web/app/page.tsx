import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import HeroReel from "@/components/site/HeroReel";
import AppDemo from "@/components/site/AppDemo";
import MTTRTimeline from "@/components/site/MTTRTimeline";
import CommitCassette from "@/components/site/CommitCassette";
import RegressionBar from "@/components/site/RegressionBar";
import ArchitectureFlow from "@/components/site/ArchitectureFlow";
import AmbientField from "@/components/AmbientField";
import { listRuns } from "@/lib/runs";
import { showcaseOrgId } from "@/lib/demoMode";
import { PLAN_INFO } from "@/lib/plans";
import { PRICING_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

export default async function Home() {
  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  // Scoped to the demo workspace, never the whole table. This previously ran
  // unscoped whenever DEMO_MODE was on — which it was on the hosted site — so
  // this marketing page was publishing every tenant's runs, input and output
  // included, to anonymous visitors.
  const showcaseOrg = await showcaseOrgId();
  if (showcaseOrg) {
    try { runs = await listRuns(4, showcaseOrg); } catch { /* DB not reachable */ }
  }

  return (
    <>
      <Header />

      {/* Hero — leads with the record/proof claim first, replay and gate as
          the practical unlock second. Was "Reproduce... Gate... Keep a
          record" — record-keeping, the actual moat, was the THIRD clause a
          reader reached. The proof-tease under the CTAs pointed at the MTTR
          stat; that stat still has a full section of its own further down,
          so the hero now points at the thing nothing else on the page
          reinforces this early: the open, independently-verifiable artifact. */}
      <section className="hero ambient-host">
        <AmbientField />
        <div className="mk hero-grid">
          <div className="hero-copy">
            <span className="mk-eyebrow">The evidentiary record for AI agents</span>
            <h1 className="hero-h1">
              Stop hoping your agents behave.{" "}
              <span className="accent">Prove it.</span>
            </h1>
            <p className="hero-lead">
              The sealed, replayable record that makes an agent&apos;s decision
              defensible — verifiable by anyone, without us. Reproduce any
              failure in minutes; gate every release before it ships.
            </p>
            <div className="hero-cta">
              <Link href="/get-started" className="btn-fill">Start free →</Link>
              <Link href="/how-it-works#incident" className="btn-line" scroll={false}>See it work →</Link>
              {/* Was a small, muted text link — the one CTA a developer
                  evaluator (as opposed to the compliance-buyer path the rest
                  of the hero is written for) actually wants first. Same
                  visual weight as "See it work" now, not an afterthought. */}
              <Link href="/docs" className="btn-line">Read the docs →</Link>
            </div>
            <p className="hero-proof-tease mono">
              runback.cassette/v1 · signed · verify independently —{" "}
              <Link href="/verify">no account, no software →</Link>
            </p>
          </div>
          <div className="hero-stack">
            <HeroReel />
          </div>
        </div>
      </section>

      {/* Proof bar — capability signals before first scroll */}
      <div className="proof-bar">
        <div className="mk proof-bar-inner">
          <div className="pb-item">
            <span className="pb-num mono">Open format</span>
            <span className="pb-label">verify without Runback — no account</span>
          </div>
          <span className="pb-div" aria-hidden="true" />
          <div className="pb-item">
            <span className="pb-num mono">4m 23s</span>
            <span className="pb-label">root cause, in the worked incident walkthrough below (illustrative)</span>
          </div>
          <span className="pb-div" aria-hidden="true" />
          <div className="pb-item">
            <span className="pb-num mono">0 bytes</span>
            <span className="pb-label">PII leaves your process</span>
          </div>
          <span className="pb-div" aria-hidden="true" />
          <div className="pb-item">
            <span className="pb-num mono">Self-host</span>
            <span className="pb-label">data never leaves your perimeter</span>
          </div>
        </div>
      </div>

      {/* Category thesis — the strongest, most defensible argument on the
          site, right after the hero's claim instead of five sections down.
          A first-time visitor gets the WHY before anything else. */}
      <section className="mk-section sec-thesis">
        <div className="mk">
          <span className="mk-eyebrow" data-tone="brand2">Why this exists</span>
          <h2 className="mk-h2 narrow">Software has the commit. AI agents have had nothing.</h2>
          <p className="mk-lead mk-lead-wide">
            The commit solved &quot;who changed what, and can we prove it&quot; for software
            decades ago. Every AI agent decision is the same kind of event — with none
            of that discipline, until it&apos;s sealed the same way.
          </p>
          <CommitCassette />
          <Link href="/how-it-works#moats" className="mk-link" scroll={false}>See why this can&apos;t be retrofitted afterward →</Link>
        </div>
      </section>

      {/* Audit spotlight — the concrete artifact the thesis above just
          argued for. Was five sections further down and repeated the same
          commit/cassette framing in its own lead paragraph; now that it sits
          right after the section that already made that case, the paragraph
          only needs to point at the specifics. */}
      <section className="mk-section audit-spotlight-sec">
        <div className="mk audit-split">
          <div className="audit-copy">
            <span className="mk-eyebrow" data-tone="brand2">Audit &amp; Governance</span>
            <h2 className="mk-h2 narrow">Every decision, sealed the moment it happens.</h2>
            <p className="mk-lead">
              The <Link href="/spec" className="mk-link">Runback cassette</Link>: every decision
              sealed in a hash-chained record you can verify without us and produce on
              demand to any auditor.
            </p>
            <ul className="audit-checks">
              <li><span className="mk-check mono">✓</span> EU AI Act Art. 12 mandatory logging</li>
              <li><span className="mk-check mono">✓</span> Scoped, revocable read-only access for auditors — no login, no export handed over blind</li>
              <li><span className="mk-check mono">✓</span> Ed25519-signed hash chain — verifiable offline, no shared secret</li>
              <li><span className="mk-check mono">✓</span> Verify without Runback — open verifier, no account</li>
            </ul>
            <div className="mk-cta-row">
              <Link href="/enterprise" className="btn-fill btn-sm">Enterprise &amp; compliance →</Link>
              <Link href="/verify" className="btn-line btn-sm">Try the verifier</Link>
            </div>
          </div>
          <div className="audit-card-wrap">
            <div className="hiw-audit-card">
              <div className="hiw-audit-row"><span className="mono k">$schema</span><span className="mono v">runback.audit/v2</span></div>
              <div className="hiw-audit-row"><span className="mono k">run_id</span><span className="mono v">loan-approval-agent</span></div>
              <div className="hiw-audit-row"><span className="mono k">events</span><span className="mono v">6 · chained</span></div>
              <div className="hiw-audit-row"><span className="mono k">content_digest</span><span className="mono v">3e68cdbbf372df98…</span></div>
              <div className="hiw-audit-row"><span className="mono k">signature</span><span className="mono v">Ed25519 <span className="hiw-audit-sig">✓ signed</span></span></div>
              <div className="hiw-audit-foot mono">POST to /api/audit/verify to recompute the chain.</div>
            </div>
          </div>
        </div>
      </section>

      {/* What the record makes possible — the 2:47 AM incident, now framed
          as a consequence of the record above (a supporting proof point),
          not the opening narrative. Same component, same story; only the
          eyebrow changed to connect it back instead of leading with it. */}
      <section className="mk-section" style={{ paddingBottom: "2rem" }}>
        <div className="mk">
          <span className="mk-eyebrow">What the record makes possible</span>
          <h2 className="mk-h2 narrow">An agent just did something wrong. Now what?</h2>
          <MTTRTimeline />
        </div>
      </section>

      {/* Who is this for — routes a first-time visitor to their path before
          the capability deep-dive below, instead of after it. */}
      <section className="mk-section sec-who">
        <div className="mk">
          <h2 className="mk-h2">Built for teams where a wrong decision matters.</h2>
          <div className="seg-short-grid">
            <div className="seg-short">
              <span className="seg-label mono" data-tone="brand">Early-stage AI team</span>
              <p>An agent breaks in production and nobody can say why. Replay the decision, fix it — that incident becomes a permanent test in one click.</p>
              <Link href="/get-started" className="seg-link mono">Get started free →</Link>
            </div>
            <div className="seg-short">
              <span className="seg-label mono" data-tone="brand2">Banks &amp; financial institutions</span>
              <p>An agent approves something a regulator later asks about. Every decision is sealed the moment it happens — one record covers APRA CPS 230, EU AI Act Art. 12, and NIST AI RMF. Self-hosted in your VPC.</p>
              <Link href="/enterprise" className="seg-link mono">Enterprise &amp; compliance →</Link>
            </div>
            <div className="seg-short">
              <span className="seg-label mono" data-tone="brand">Law firms &amp; professional services</span>
              <p>Opposing counsel — or your own client — asks exactly what the AI said and why. Every session is captured, sealed, and replayable for court; high-risk outputs are flagged before they reach the lawyer.</p>
              <Link href="/enterprise" className="seg-link mono">Governance for legal →</Link>
            </div>
            <div className="seg-short">
              <span className="seg-label mono" data-tone="brand2">Safety-critical deployments</span>
              <p>The decision that can&apos;t be wrong is the one you can&apos;t watch every time. A policy gate runs before the call — the block is sealed into the record.</p>
              <Link href="/how-it-works" className="seg-link mono">How it works →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Four jobs */}
      <section className="mk-section sec-jobs">
        <div className="mk">
          <span className="mk-eyebrow">What Runback does</span>
          <h2 className="mk-h2">The four things standing between you and a 2 AM page.</h2>
          <div className="four-jobs">
            <div className="job-card" data-tone="brand">
              <span className="job-n mono">01</span>
              <h3>Observe</h3>
              <p>Every model call — context, tools, tokens — captured at the boundary. PII redacted in-process before anything leaves your app.</p>
              <Link href="/how-it-works#observe" className="job-link" scroll={false}>Capture →</Link>
            </div>
            <div className="job-connector" aria-hidden="true"><span className="job-connector-arrow">→</span></div>
            <div className="job-card" data-tone="brand2">
              <span className="job-n mono">02</span>
              <h3>Replay</h3>
              <p>Re-run from the exact captured context — tools, retrieval, messages[] held fixed. A different output means behaviour changed. Root cause in minutes, not a war room.</p>
              <Link href="/how-it-works#incident" className="job-link" scroll={false}>Walk the demo →</Link>
            </div>
            <div className="job-connector" aria-hidden="true"><span className="job-connector-arrow">→</span></div>
            <div className="job-card" data-tone="brand">
              <span className="job-n mono">03</span>
              <h3>Gate</h3>
              <p>Simulate a policy against 90 days of decisions. Enforce it live — block the violating action before it runs.</p>
              <Link href="/how-it-works#gate" className="job-link" scroll={false}>Policy gates →</Link>
            </div>
            <div className="job-connector" aria-hidden="true"><span className="job-connector-arrow">→</span></div>
            <div className="job-card" data-tone="brand2">
              <span className="job-n mono">04</span>
              <h3>Audit</h3>
              <p>SHA-256 hash-chained, Ed25519-signed record. Tamper-evident. The artifact your compliance team actually asks for.</p>
              <Link href="/enterprise" className="job-link">Enterprise →</Link>
            </div>
          </div>
          <div className="jobs-loop">
            <svg className="jobs-loop-svg" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="jobsLoopArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" style={{ fill: "var(--brand)" }} />
                </marker>
              </defs>
              <path
                d="M 875 0 C 875 42, 125 42, 125 0"
                fill="none"
                style={{ stroke: "var(--brand)" }}
                strokeWidth="1.5"
                strokeOpacity="0.55"
                markerEnd="url(#jobsLoopArrow)"
              />
            </svg>
            <p className="jobs-loop-label">
              <span className="jobs-loop-icon" aria-hidden="true">↺</span> Every incident becomes a regression test —{" "}
              <Link href="/how-it-works#moats" className="mk-link" scroll={false}>why this compounds →</Link>
            </p>
          </div>
        </div>
      </section>

      {/* Gate at scale — an illustrative example, not a customer statistic
          (matching the incident walkthrough elsewhere on the site: "not a
          customer story — we're too early for one"). Makes the Gate job
          card's abstract pitch concrete: what a model/prompt swap actually
          means is replaying it against everything you've already shipped,
          not one hand-picked test case. */}
      <section className="mk-section sec-gate-scale">
        <div className="mk">
          <span className="mk-eyebrow">Example — one model swap, replayed against history</span>
          <h2 className="mk-h2 narrow">Not &quot;does it pass one test.&quot; What does it do differently across everything you&apos;ve shipped.</h2>
          <RegressionBar />
        </div>
      </section>

      {/* Integration */}
      <section className="mk-section sec-integ">
        <div className="mk">
          <span className="mk-eyebrow">Plugs into what you already run</span>
          <h2 className="mk-h2">Wrap what&apos;s already running. Nothing to migrate.</h2>
          <p className="mk-lead mk-lead-flush" style={{ marginBottom: "1.6rem" }}>
            Not a new platform — Runback wraps the model calls your agents
            already make. Add it to one agent today; it&apos;s live from the
            next request.
          </p>
          <ArchitectureFlow />
          <div className="integ-code-row">
            <pre className="mk-code integ-pre">
              <code>{`import { withDebugger } from "@runback/sdk";

const dbg = withDebugger(model, { runName: "support-agent", redact: "standard" });
const res = await generateText({ model: dbg.model, tools: dbg.tools(myTools), prompt: task });
await dbg.finish({ output: res.text, status: "success" });`}</code>
            </pre>
            <div className="integ-methods">
              <div className="integ-method">
                <span className="integ-method-tag mono">SDK</span>
                <span>Deepest capture — context, tool calls, token-level detail</span>
              </div>
              <div className="integ-method">
                <span className="integ-method-tag mono">Proxy</span>
                <span>No code changes — swap your base URL</span>
              </div>
              <div className="integ-method">
                <span className="integ-method-tag mono">OTel</span>
                <span>Already sending traces? Runback consumes them natively</span>
              </div>
              <Link href="/how-it-works" className="integ-flow-link">Full data flow →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* vs LangSmith / Langfuse */}
      <section className="mk-section sec-vs">
        <div className="mk">
          <span className="mk-eyebrow">Already using LangSmith or Langfuse?</span>
          <h2 className="mk-h2">Observation shows the symptom. Re-execution finds the cause.</h2>
          <p className="mk-lead mk-lead-flush mk-lead-wide">
            Observability tools assume determinism: same code, same trace, twice. AI agents
            don&apos;t — every decision depends on context assembled at runtime: retrieved
            documents, tool outputs, the exact messages[] the model saw. A log shows the
            outcome. Only a re-executable run shows the reasoning.
          </p>
          <p className="mk-lead mk-lead-flush mk-lead-wide">
            Keep Langfuse, LangSmith, Datadog — none of it goes away. Runback isn&apos;t
            another place to look at logs; it&apos;s the layer above them that turns
            &quot;here&apos;s what happened&quot; into &quot;here&apos;s the exact context,
            reproduced, and the record to prove it.&quot;
          </p>
          <p className="table-scroll-hint mono">Swipe to see all columns →</p>
          <div className="table-scroll">
            <div className="cmp cmp-table-inner" data-cols="3" data-verified="July 2026">
              <div className="cmp-row cmp-head">
                <div className="cmp-feat" />
                <div className="cmp-c">LangSmith · Langfuse</div>
                <div className="cmp-c cmp-us">Runback</div>
              </div>
              {([
                ["Read the trace after the fact", "y", "y"],
                ["Re-run from the exact captured context", "n", "y"],
                ["CI release gate — block regressions before deploy", "n", "y"],
                ["Signed, tamper-evident audit export", "n", "y"],
                ["Self-host, data never leaves your perimeter", "~", "y"],
                // "~" not "n", to match lib/competitors.ts — the sourced file, which
                // notes LangSmith publishes an EU AI Act crosswalk (no CPS 230 or NIST).
                // /vs/langsmith renders "partial" for this exact row from that file, so a
                // hard "n" here had us contradicting ourselves on two public pages.
                ["Regulatory controls (EU AI Act · CPS 230 · NIST)", "~", "y"],
              ] as [string, string, string][]).map(([f, a, b]) => (
                <div className="cmp-row" key={f}>
                  <div className="cmp-feat">{f}</div>
                  <div className="cmp-c"><span className="cmp-cell" data-v={a}>{a === "y" ? "✓" : a === "n" ? "✗" : "partial"}</span></div>
                  <div className="cmp-c cmp-us"><span className="cmp-cell" data-v={b}>{b === "y" ? "✓" : b === "n" ? "✗" : "partial"}</span></div>
                </div>
              ))}
            </div>
          </div>
          <p className="cmp-verified-note">
            Verified September 2026 — reviewed quarterly, and every ✓ above runs green in{" "}
            <a href="https://github.com/letsRunback/runback-proofs/actions" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>public CI ↗</a>.
          </p>
        </div>
      </section>

      {/* Product demo */}
      <section className="mk-section" id="demo">
        <div className="mk">
          <span className="mk-eyebrow">The product</span>
          <h2 className="mk-h2">Incident to proof — in one platform.</h2>
          <AppDemo />
        </div>
      </section>

      {/* Live runs */}
      {runs.length > 0 && (
        <section className="mk-section">
          <div className="mk">
            <span className="mk-eyebrow" data-tone="brand2">Live</span>
            <h2 className="mk-h2">Real runs, right now.</h2>
            <p className="mk-lead">Open one and walk through it yourself — no signup.</p>
            <ul className="run-cards">
              {runs.map((r) => (
                <li key={r.run_id}>
                  <Link href={`/runs/${r.run_id}`} className="run-card">
                    <span className={`pill pill-${r.status}`}>{r.status}</span>
                    <span className="rc-name">{r.name}</span>
                    <span className="rc-meta mono">{r.step_count} steps · {r.total_tokens.toLocaleString()} tok</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>Ship the next agent knowing you can defend the last one.</h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: "50ch", margin: "0.75rem auto 0" }}>
            Start free on managed cloud, clone the source and self-host, or book a call — we&apos;ll walk it through live in your environment.
          </p>
          <p className="mono" style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.6rem auto 0" }}>
            Managed plans from {PLAN_INFO.starter.priceLabel} —{" "}
            <Link href={PRICING_HREF} style={{ color: "var(--brand)" }}>full pricing →</Link>
          </p>
          <div className="hero-cta hero-cta-center" style={{ marginTop: "1.5rem" }}>
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <Link href="/demo" className="btn-line">Book a call</Link>
            {/* Mirrors the segment router above (sec-who) — a compliance
                reader who scrolled through the audit/regulatory section
                shouldn't be dropped back into a generic self-serve/call
                binary with no path back to the page built for them. */}
            <Link href="/enterprise" className="mk-link mk-cta-tertiary">or see Enterprise &amp; compliance →</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
