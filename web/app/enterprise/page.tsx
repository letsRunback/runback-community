import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import PageJourney from "@/components/site/PageJourney";
import InteractiveTrace from "@/components/site/InteractiveTrace";
import { pageMetadata } from "@/lib/seo";
import { GATE_SCENARIO } from "@/components/site/scenarios";
import ExposureCalculator from "@/components/site/ExposureCalculator";
import { PRICING_HREF } from "@/lib/edition";

export const metadata = pageMetadata({
  path: "/enterprise",
  title: "For security & risk teams",
  description: "Govern AI agents without your data leaving your perimeter: every decision sealed in an audit-ready record, reproduce any incident, block a tool call against your own runtime rules before it executes, and grant an auditor scoped read-only access without a login.",
});

export default function Enterprise() {
  return (
    <>
      <Header />
      <PageJourney
        current="/enterprise"
        why="The same mechanism, proven against what a security or compliance review actually demands."
        next={{ href: PRICING_HREF, label: "What this costs, by tier" }}
      />

      {/* ── Hero ── */}
      <section className="hero">
        <div className="mk hero-grid">
          <div className="hero-copy">
            <span className="mk-eyebrow">For security, risk &amp; compliance</span>
            <h1 className="hero-h1">
              Regulators are already asking. <span className="accent">Can you prove it?</span>
            </h1>
            <p className="hero-lead">
              Every decision sealed in a tamper-evident record — none of it leaves your
              perimeter. Reproduce any incident. Gate every release.
            </p>
            <p className="hero-lead ent-pressure-line">
              If an autonomous system moves money, changes infrastructure, approves a customer,
              or writes production code — can you prove what it did?
            </p>
            <div className="hero-cta">
              <Link href="/demo" className="btn-fill">Book a security review →</Link>
              <Link href="/procurement" className="btn-line">Procurement kit →</Link>
            </div>
            <div className="hero-meta">
              <span>Maps to</span>
              <code>APRA CPS 230</code>
              <code>EU AI Act Art. 12</code>
              <code>NIST AI RMF</code>
            </div>
          </div>
          <div className="hero-stack">
            <InteractiveTrace scenario={GATE_SCENARIO} />
          </div>
        </div>
      </section>

      {/* ── Problem: 3 visual scenario cards ── */}
      <section className="mk-section ent-problems-sec">
        <div className="mk">
          <div className="ent-prob-grid">
            {/* 01 */}
            <div className="ent-prob-card">
              <div className="ent-prob-label mono" data-tone="brand">Incident</div>
              <div className="ent-prob-timeline">
                <div className="ept-node" data-state="ok">
                  <span className="ept-dot" />
                  <span className="ept-text">Agent runs</span>
                </div>
                <div className="ept-gap">
                  <span className="ept-gap-line" />
                  <span className="ept-gap-label mono">3 days</span>
                </div>
                <div className="ept-node" data-state="fail">
                  <span className="ept-dot" />
                  <span className="ept-text">Customer complaint</span>
                </div>
                <div className="ept-gap">
                  <span className="ept-gap-line" />
                </div>
                <div className="ept-node" data-state="fail">
                  <span className="ept-dot" />
                  <span className="ept-text">Logs only — can&apos;t prove</span>
                </div>
              </div>
              <p className="ent-prob-note">Without a reproducible record, you can&apos;t demonstrate control of your own system.</p>
            </div>

            {/* 02 */}
            <div className="ent-prob-card">
              <div className="ent-prob-label mono" data-tone="brand2">Audit</div>
              <div className="ent-prob-ask">
                <div className="ept-ask-bubble">
                  <span className="ept-ask-who mono">Auditor</span>
                  <span className="ept-ask-q">&ldquo;Show me every agent decision, last 90 days. Tamper-evident.&rdquo;</span>
                </div>
                <div className="ept-ask-resp" data-state="fail">
                  <span className="ept-resp-icon">✗</span>
                  <span>Log lines don&apos;t qualify</span>
                </div>
                <div className="ept-ask-resp" data-state="ok">
                  <span className="ept-resp-icon">✓</span>
                  <span>Runback — sealed, verifiable export</span>
                </div>
              </div>
            </div>

            {/* 03 */}
            <div className="ent-prob-card">
              <div className="ent-prob-label mono" data-tone="brand">Board</div>
              <div className="ent-prob-stat">
                <div className="ent-stat-badge" data-tone="brand">
                  EU AI Act
                </div>
                <p className="ent-stat-q">&ldquo;Are our AI systems in scope? Do we have compliant logs?&rdquo;</p>
                <div className="ent-stat-status">
                  <span className="ent-stat-dot" data-state="warn" />
                  <span className="mono">Most enterprises have no honest answer today.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Exposure calculator ── */}
      <section className="mk-section" id="calculator">
        <div className="mk">
          <span className="mk-eyebrow">The cost of doing nothing</span>
          <h2 className="mk-h2">The exposure is already on your books.</h2>
          <ExposureCalculator />
        </div>
      </section>

      {/* ── Why logs don't cover you ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Why existing tools don&apos;t cover you</span>
          <h2 className="mk-h2">A log tells you what happened. It can&apos;t tell you why.</h2>
          <p className="mk-lead mk-lead-wide">
            When a regulator asks why an agent approved a loan, &quot;the log says it
            happened&quot; isn&apos;t an answer — you need to reproduce the decision on demand.
            A dashboard built for deterministic software can tell you a call was made; it
            can&apos;t re-derive the reasoning, because the context was never captured as a
            re-executable unit.
          </p>

          <p className="mk-lead mk-lead-wide mk-lead-top" style={{ marginBottom: "0.9rem" }}>
            Four failure classes matter in regulated production — none visible in a log,
            all visible in a replay:
          </p>
          <div className="ent-failure-classes">
            <span className="why-model-pill mono" data-tone="rose">Policy violation</span>
            <span className="why-model-pill mono" data-tone="amber">Context contamination</span>
            <span className="why-model-pill mono" data-tone="violet">Prompt injection</span>
            <span className="why-model-pill mono" data-tone="blue">Model drift</span>
          </div>
          <p className="mk-lead-top" style={{ fontSize: "0.88rem" }}>
            <Link href="/how-it-works" className="mk-link">See the exact scenario →</Link>
          </p>

          {/* Was the third paragraph in a stack of three identical-looking
              blocks — a citable, concrete number (141,006 runs swept to find
              3 incidents) buried at the same visual weight as the surrounding
              argument prose. Pulled out as its own callout so the number
              reads before the sentence around it does. */}
          <div className="ent-incident-callout mk-lead-top">
            <div className="ent-incident-stats">
              <div className="ent-incident-stat">
                <span className="ent-incident-n">141,006</span>
                <span className="ent-incident-l mono">runs swept, by hand</span>
              </div>
              <div className="ent-incident-stat">
                <span className="ent-incident-n ent-incident-n-bad">3</span>
                <span className="ent-incident-l mono">incidents found</span>
              </div>
            </div>
            <p className="ent-incident-note">
              Not hypothetical: in July 2026, Anthropic needed a retrospective sweep of
              cybersecurity-evaluation runs to find three incidents where a
              misconfiguration let Claude reach live infrastructure.{" "}
              <a href="https://www.anthropic.com/news/investigating-incidents-cybersecurity-evals" target="_blank" rel="noopener noreferrer" className="mk-link">Anthropic&apos;s writeup →</a>{" "}
              That&apos;s the cost of an instrumentation gap at scale — a six-figure manual
              sweep, not a query.
            </p>
          </div>
        </div>
      </section>

      {/* ── How it works: visual 4-step flow ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">How it works</span>
          <h2 className="mk-h2">One record. From decision to proof.</h2>
          <div className="ent-how-flow">
            {/* 01 Observe */}
            <div className="ent-hw-card">
              <div className="ent-hw-seq mono">01 · Observe</div>
              <div className="ent-hw-preview">
                <div className="ent-hw-run-row">
                  <span className="pill pill-error">failed</span>
                  <span className="ent-hw-name">loan-approval-agent</span>
                </div>
                <div className="ent-hw-run-meta">6 steps · 1,030 tok · gpt-4o</div>
                <div className="ent-hw-run-pii">↳ PII: 2 fields redacted in-process</div>
              </div>
              <div className="ent-hw-sub">Every model call — context, tools, tokens — captured at the boundary.</div>
            </div>

            {/* 02 Replay */}
            <div className="ent-hw-card">
              <div className="ent-hw-seq mono">02 · Replay</div>
              <div className="ent-hw-preview">
                <div className="ent-hw-cmp" data-result="pass">
                  <span className="ent-hw-cmodel">gpt-4o</span>
                  <span className="ent-hw-caction">→ escalate(dispute)</span>
                  <span className="pill pill-success">pass</span>
                </div>
                <div className="ent-hw-cmp" data-result="fail">
                  <span className="ent-hw-cmodel">llama-3.3</span>
                  <span className="ent-hw-caction">→ issue_refund(250)</span>
                  <span className="pill pill-error">regression</span>
                </div>
              </div>
              <div className="ent-hw-sub">Re-run from exact context. Different output = behaviour changed.</div>
            </div>

            {/* 03 Gate */}
            <div className="ent-hw-card">
              <div className="ent-hw-seq mono">03 · Gate</div>
              <div className="ent-hw-preview">
                <div className="ent-hw-gcall">issue_refund(&#123; amount: 250 &#125;)</div>
                <div className="ent-hw-gblock">✗ BLOCKED · no_refund_over_100</div>
                <div className="ent-hw-gseal">sealed · seq: 4 · hash: 09c4…</div>
              </div>
              <div className="ent-hw-sub">Policy check fires before the call. Block sealed into the record.</div>
            </div>

            {/* 04 Audit */}
            <div className="ent-hw-card">
              <div className="ent-hw-seq mono">04 · Audit</div>
              <div className="ent-hw-preview">
                <div className="ent-hw-kv"><span>$schema</span><span>runback.cassette/v1</span></div>
                <div className="ent-hw-kv"><span>entries</span><span>6 · chained</span></div>
                <div className="ent-hw-kv"><span>algo</span><span>oracle-chain/sha256</span></div>
                <div className="ent-hw-kv ent-hw-vfy"><span>sig</span><span>✓ verified</span></div>
              </div>
              <div className="ent-hw-sub">SHA-256 chained, Ed25519-signed. Verify without a Runback account.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Architecture: where Runback sits ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Architecture</span>
          <h2 className="mk-h2">Where Runback sits in your stack.</h2>
          <p className="mk-lead mk-lead-gap-xs">
            One SDK wrap. Your existing systems untouched. Your data never leaves your perimeter.
          </p>

          <div className="arch-diag">

            {/* Row 1: External services */}
            <div className="arch-row arch-row-2">
              <div className="arch-node arch-node-ext">
                <span className="arch-node-label">Model Provider</span>
                <span className="arch-node-sub mono">OpenAI · Anthropic · Azure · on-prem</span>
              </div>
              <div className="arch-node arch-node-ext">
                <span className="arch-node-label">Your Tools &amp; Systems</span>
                <span className="arch-node-sub mono">core banking · CRM · credit bureau · case management</span>
              </div>
            </div>

            {/* Connector: external → VPC */}
            <div className="arch-tier-sep">
              <div className="arch-tier-line" />
              <div className="arch-tier-arrow">↓</div>
              <div className="arch-tier-lbl mono">API &amp; tool calls</div>
            </div>

            {/* VPC boundary */}
            <div className="arch-vpc">
              <div className="arch-vpc-tag mono">Your org · your VPC · your infrastructure</div>

              {/* Agents cluster */}
              <div className="arch-cluster">
                <div className="arch-cluster-hd">
                  <span className="arch-cluster-title">Your Agent Applications</span>
                  <span className="arch-sdk-badge mono">+ Runback SDK</span>
                </div>
                <div className="arch-agents">
                  <div className="arch-agent">
                    <span className="arch-agent-nm">Loan Agent</span>
                    <span className="arch-agent-fn mono">issue_approval</span>
                  </div>
                  <div className="arch-agent">
                    <span className="arch-agent-nm">Fraud Agent</span>
                    <span className="arch-agent-fn mono">flag_transaction</span>
                  </div>
                  <div className="arch-agent">
                    <span className="arch-agent-nm">Compliance Agent</span>
                    <span className="arch-agent-fn mono">check_policy</span>
                  </div>
                </div>
                <div className="arch-cluster-note mono">3 lines · post-hook only · real model calls run untouched · ~0.16ms added, measured</div>
              </div>

              {/* Inner connector: agents → postgres */}
              <div className="arch-inner-sep">
                <div className="arch-inner-line" />
                <div className="arch-inner-tip">↓</div>
                <div className="arch-inner-lbls">
                  <span className="mono" data-tone="brand">PII stripped in-process</span>
                  <span className="mono">async · non-blocking</span>
                </div>
              </div>

              {/* Postgres */}
              <div className="arch-node arch-node-db">
                <span className="arch-node-label">Your Postgres</span>
                <span className="arch-node-sub mono">runs · spans · policies · audit trail · your encryption keys · your retention rules</span>
              </div>

              {/* Inner connector: postgres → runback */}
              <div className="arch-inner-sep">
                <div className="arch-inner-line" />
                <div className="arch-inner-tip">↓</div>
                <div className="arch-inner-lbls">
                  <span className="mono" data-tone="brand2">reads only · Runback never writes to your data</span>
                </div>
              </div>

              {/* Runback Platform */}
              <div className="arch-node arch-node-platform">
                <div className="arch-plat-hd">
                  <span className="arch-plat-nm">Runback Platform</span>
                  <span className="arch-plat-note mono">self-hosted in your VPC</span>
                </div>
                <div className="arch-caps">
                  <span data-tone="brand">Observe</span>
                  <span data-tone="brand2">Replay</span>
                  <span data-tone="brand">Gate</span>
                  <span data-tone="brand2">Audit</span>
                  <span>Evals</span>
                  <span>Golden</span>
                </div>
              </div>
            </div>

            {/* Connector: VPC → consumers */}
            <div className="arch-tier-sep">
              <div className="arch-tier-line" />
              <div className="arch-tier-arrow">↓</div>
              <div className="arch-tier-lbl mono">secure access · role-scoped</div>
            </div>

            {/* Row 3: Consumers */}
            <div className="arch-row arch-row-3">
              <div className="arch-node arch-node-consumer">
                <span className="arch-node-label">Risk &amp; Eng Teams</span>
                <span className="arch-node-sub mono">debug · replay · root cause</span>
              </div>
              <div className="arch-node arch-node-consumer">
                <span className="arch-node-label">CI / Release Gate</span>
                <span className="arch-node-sub mono">eval suite · regression block</span>
              </div>
              <div className="arch-node arch-node-consumer">
                <span className="arch-node-label">Auditors &amp; Regulators</span>
                <span className="arch-node-sub mono">cassette export · verify offline · scoped read-only grant, no login</span>
              </div>
            </div>

            <p className="arch-foot mono">
              Enterprise: fully self-hosted — Runback platform runs in your cloud, data never leaves your perimeter
              &nbsp;·&nbsp;
              Cloud: Runback-managed, PII stripped before ingest, encrypted in transit
            </p>
          </div>
        </div>
      </section>

      {/* ── Data perimeter ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Data perimeter</span>
          <h2 className="mk-h2">Your traces. Your keys. Your building.</h2>

          <div className="ent-perimeter-cards">
            <div className="ent-perimeter-card">
              <div className="ent-pc-accent" data-tone="brand" />
              <div>
                <div className="ent-pc-k">Self-host in your VPC</div>
                <div className="ent-pc-v">A Next.js app + Postgres. Traces never touch our servers.</div>
              </div>
            </div>
            <div className="ent-perimeter-card">
              <div className="ent-pc-accent" data-tone="brand2" />
              <div>
                <div className="ent-pc-k">Redact before egress</div>
                <div className="ent-pc-v">Keys, emails, card numbers, SSNs — scrubbed inside your process.</div>
              </div>
            </div>
            <div className="ent-perimeter-card">
              <div className="ent-pc-accent" data-tone="brand" />
              <div>
                <div className="ent-pc-k">You own the store</div>
                <div className="ent-pc-v">You set retention and access. Delete a run — it&apos;s gone.</div>
              </div>
            </div>
            <div className="ent-perimeter-card">
              <div className="ent-pc-accent" data-tone="brand2" />
              <div>
                <div className="ent-pc-k">Open format</div>
                <div className="ent-pc-v">SDK + OTel, documented schema. Export and keep your history.</div>
              </div>
            </div>
          </div>

          {/* Residency table */}
          <p className="table-scroll-hint mono">Swipe to see all columns →</p>
          <div className="table-scroll ent-residency-wrap">
            <table className="ptab">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Where traces go</th>
                  <th>EU / AU residency</th>
                  <th>DPA</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["Community (self-hosted)", "Your Postgres, your infra", "✓ your region", "n/a"],
                  ["Starter · Growth · Scale · Pro", "Runback cloud (US)", "Enterprise only", "On request"],
                  ["Enterprise (self-hosted)", "Your Postgres in your VPC", "✓ your region", "Included"],
                ] as [string, string, string, string][]).map(([tier, where, eu, dpa]) => (
                  <tr key={tier}>
                    <td className="mono">{tier}</td>
                    <td>{where}</td>
                    <td className="ptab-center">{eu}</td>
                    <td className="ptab-center">{dpa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ent-reliability-note">
            <span className="ent-rel-dot" data-state="ok" />
            <span><strong>Policy gates fail open</strong> by default — your agent is never blocked by an outage. Enterprise can configure fail-closed. A failed trace send retries in-process on the next flush; that buffer isn&apos;t persisted, so events not yet flushed are lost if the process exits first.</span>
          </div>

          <div className="mk-cta-row" style={{ marginTop: "1.6rem" }}>
            <Link href="/get-started" className="btn-fill btn-sm">Self-host the source →</Link>
            <span className="mono" style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Free Community edition, container-based, deploys in your own VPC — the setup guide ships in the repo.
            </span>
          </div>
        </div>
      </section>

      {/* ── Comparison ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">vs. DIY logging &amp; observability tools</span>
          <h2 className="mk-h2">Logs let you read what happened. Runback lets you prove it.</h2>
          <p className="table-scroll-hint mono">Swipe to see all columns →</p>
          <div className="table-scroll">
            <div className="cmp">
              <div className="cmp-row cmp-head">
                <div className="cmp-feat" />
                <div className="cmp-c">DIY logging</div>
                <div className="cmp-c">LangSmith · Langfuse</div>
                <div className="cmp-c cmp-us">Runback</div>
              </div>
              {[
                { f: "Read the full trace after the fact", v: ["~", "y", "y"] },
                { f: "Built-in evals & datasets", v: ["n", "y", "y"] },
                { f: "Re-execute the exact captured step", v: ["n", "n", "y"] },
                { f: "Signed, tamper-evident audit export", v: ["n", "n", "y"] },
                { f: "Self-host · data never leaves your perimeter", v: ["y", "~", "y"] },
                // LangSmith is "~" in lib/competitors.ts (EU AI Act crosswalk, no CPS 230/NIST).
                { f: "Maps to regulated controls (CPS 230 · EU AI Act)", v: ["~", "n", "y"] },
              ].map((r) => (
                <div className="cmp-row" key={r.f}>
                  <div className="cmp-feat">{r.f}</div>
                  {r.v.map((c, i) => (
                    <div className={`cmp-c${i === 2 ? " cmp-us" : ""}`} key={i}>
                      <span className="cmp-cell" data-v={c}>{c === "y" ? "✓" : c === "n" ? "✗" : "partial"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <p className="cmp-verified-note">Verified September 2026 — reviewed quarterly.</p>
        </div>
      </section>

      {/* ── Category landscape: where Runback sits vs. adjacent categories ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Where Runback fits</span>
          <h2 className="mk-h2">You probably already have some of these. That&apos;s not overlap.</h2>
          <p className="mk-lead mk-lead-wide" style={{ marginBottom: "2rem" }}>
            Cloud posture tools, guardrail filters, and SIEM platforms are all real — most
            security teams run more than one. None capture a specific agent decision,
            enforce your own rules before it executes, or seal it into a signed record.
            That&apos;s the layer Runback adds underneath whatever you already run.
          </p>
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div className="card" style={{ padding: "1.4rem 1.5rem" }}>
              <div className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.6rem" }}>
                Cloud security posture (CNAPP)
              </div>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                Scores cloud resources and model endpoints against config rules.{" "}
                <strong style={{ color: "var(--text-primary)" }}>Doesn&apos;t see:</strong> what a
                specific agent decided on a specific call.
              </p>
            </div>
            <div className="card" style={{ padding: "1.4rem 1.5rem" }}>
              <div className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand-2)", marginBottom: "0.6rem" }}>
                LLM observability &amp; tracing
              </div>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                Captures traces so you can read what an agent did after the fact.{" "}
                <strong style={{ color: "var(--text-primary)" }}>Doesn&apos;t see:</strong> traces
                are read-only — no re-execution, no tamper-evident export.{" "}
                <Link href="/vs" className="mk-link">/vs →</Link>
              </p>
            </div>
            <div className="card" style={{ padding: "1.4rem 1.5rem" }}>
              <div className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.6rem" }}>
                AI guardrail / content moderation
              </div>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                Blocks unsafe input/output in real time.{" "}
                <strong style={{ color: "var(--text-primary)" }}>Doesn&apos;t see:</strong> your
                business logic — &quot;never refund over $100&quot; isn&apos;t unsafe content.
              </p>
            </div>
            <div className="card" style={{ padding: "1.4rem 1.5rem" }}>
              <div className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand-2)", marginBottom: "0.6rem" }}>
                SIEM / log aggregation
              </div>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                Ingests logs everywhere for search and correlation.{" "}
                <strong style={{ color: "var(--text-primary)" }}>Doesn&apos;t see:</strong> an
                agent decision as more than a log line — nothing re-executable to replay.
              </p>
            </div>
            <div className="card" style={{ padding: "1.4rem 1.5rem" }}>
              <div className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.6rem" }}>
                Proof / notarization-only services
              </div>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                Hashes and signs a payload to prove it existed unchanged.{" "}
                <strong style={{ color: "var(--text-primary)" }}>Doesn&apos;t see:</strong> anything
                upstream — no captured context, no rule enforced beforehand.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust chain: visual ── */}
      <section className="mk-section" id="trust">
        <div className="mk">
          <span className="mk-eyebrow">Inter-agent trust fabric</span>
          <h2 className="mk-h2">Every delegation is signed. The chain is provable.</h2>

          <div className="ent-trust-split">
            <div className="ent-trust-why">
              <div className="ent-tw-card" data-state="problem">
                <div className="ent-tw-label mono" data-tone="rose">The gap</div>
                <div className="ent-tw-flow">
                  <div className="ent-tf-node">Orchestrator</div>
                  <div className="ent-tf-edge" data-trust="none">
                    <span className="ent-tf-label mono">delegates to ↓</span>
                    <span className="ent-tf-warn">no cryptographic proof</span>
                  </div>
                  <div className="ent-tf-node" data-state="warn">Subagent</div>
                </div>
                <p className="ent-tw-note">Scope can be widened in transit. No proof of who called or what was permitted.</p>
              </div>
              <div className="ent-tw-card" data-state="solution">
                <div className="ent-tw-label mono" data-tone="emerald">With Runback</div>
                <div className="ent-tw-flow">
                  <div className="ent-tf-node" data-accent>Orchestrator</div>
                  <div className="ent-tf-edge" data-trust="signed">
                    <span className="ent-tf-label mono">Ed25519-signed token ↓</span>
                    <span className="ent-tf-ok mono">scope: read:customer</span>
                  </div>
                  <div className="ent-tf-node" data-accent>Subagent</div>
                </div>
                <p className="ent-tw-note">Every delegation edge sealed. Chain exports as a verifiable artifact.</p>
              </div>
            </div>

            <div className="ent-trust-chain">
              <div className="ent-tc-head">
                <span className="mono">Trust chain · runback:trust-chain:v2</span>
                <span className="ent-tc-badge">✓ verified</span>
              </div>
              <p className="ent-tc-caveat mono">Same signing primitive as the per-run audit record above — Ed25519 where a keypair is configured, HMAC-SHA256 fallback without one. (The separate org-wide ledger checkpoint uses HMAC plus independent RFC 3161 timestamping — see Security.)</p>
              {[
                { agent: "loan-orchestrator", depth: 0, token: "a3f8c2d1…b9e4", root: true },
                { agent: "kyc-subagent", depth: 1, token: "7b2e9f4a…c1d8", root: false, scope: "*" },
                { agent: "credit-check-agent", depth: 2, token: "4d1c8b3e…f2a9", root: false, scope: "read:customer" },
              ].map((item, i) => (
                <div key={i}>
                  {i > 0 && (
                    <div className="ent-tc-connector">
                      <span className="ent-tc-vline" />
                      <span className="mono ent-tc-scope">delegates · scope: {item.scope}</span>
                    </div>
                  )}
                  <div className={`ent-tc-node${item.root ? " ent-tc-root" : ""}`}>
                    <span className="ent-tc-dot" />
                    <span className="ent-tc-name mono">{item.agent}</span>
                    <span className="ent-tc-meta mono">depth {item.depth}</span>
                    <span className="ent-tc-token mono">{item.token}</span>
                  </div>
                </div>
              ))}
              <div className="ent-tc-foot mono">POST to /api/trust/verify — no account required.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Regulatory coverage: visual cards ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Regulatory coverage</span>
          <h2 className="mk-h2">The evidence your controls require.</h2>
          <div className="ent-reg-grid">
            <div className="ent-reg-card">
              <div className="ent-reg-frame mono">APRA CPS 230</div>
              <div className="ent-reg-art">Operational risk &amp; incident management</div>
              <ul className="ent-reg-list">
                <li><span className="mk-check mono">✓</span> Incident capture + sealed record</li>
                <li><span className="mk-check mono">✓</span> Reproducible audit trail</li>
                <li><span className="mk-check mono">✓</span> Continuous monitoring data</li>
              </ul>
            </div>
            <div className="ent-reg-card">
              <div className="ent-reg-frame mono">EU AI Act</div>
              <div className="ent-reg-art">Art. 12 · Logging &amp; traceability</div>
              <ul className="ent-reg-list">
                <li><span className="mk-check mono">✓</span> Tamper-evident decision log</li>
                <li><span className="mk-partial mono">~</span> Human oversight record — captured where an approval gate is used; a reviewer step outside Runback isn&apos;t in our record (<Link href="/eu-ai-act" className="mk-link">detail →</Link>)</li>
                <li><span className="mk-check mono">✓</span> Verifiable export for regulators</li>
              </ul>
            </div>
            <div className="ent-reg-card">
              <div className="ent-reg-frame mono">NIST AI RMF</div>
              <div className="ent-reg-art">Govern · Map · Measure · Manage</div>
              <ul className="ent-reg-list">
                <li><span className="mk-check mono">✓</span> Policy simulation against real data</li>
                <li><span className="mk-check mono">✓</span> Behavioral drift detection</li>
                <li><span className="mk-check mono">✓</span> Defensible decision record</li>
              </ul>
            </div>
          </div>
          <div className="ent-reg-note">
            <span className="ent-rn-badge mono">Enterprise</span>
            <span>Seven frameworks mapped to Runback capabilities — the three above, plus ISO/IEC 42001, GDPR, ISO 27001, and APRA CPS 234 (<Link href={PRICING_HREF} className="mk-link">full list →</Link>). Status is computed live from your run data, not a static crosswalk — any control&apos;s evidence can be explained in plain English on demand, and that explanation is itself sealed.</span>
            <Link href="/contact" className="mk-link">Ask us about this mapping →</Link>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>Deploy AI agents with proof of control — not just proof of deployment.</h2>
          <p>We&apos;ll join your security review call, answer questions directly, and provide a DPA on request. Most reviews complete in one session.</p>
          <div className="hero-cta hero-cta-center">
            <Link href="/demo" className="btn-fill">Book a security review →</Link>
            <Link href="/how-it-works" className="btn-line">Walk the incident scenario</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
