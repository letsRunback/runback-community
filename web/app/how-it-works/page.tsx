import Link from "next/link";
import Header from "@/components/site/Header";
import HashChainViz from "@/components/site/HashChainViz";
import MerkleViz from "@/components/site/MerkleViz";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";
import Moats from "@/components/site/Moats";
import IncidentCompare from "@/components/site/IncidentCompare";
import InteractiveTrace from "@/components/site/InteractiveTrace";
import BisectVisualizer from "@/components/site/BisectVisualizer";
import PageJourney from "@/components/site/PageJourney";

export const metadata = pageMetadata({
  path: "/how-it-works",
  title: "How it works",
  description:
    "From a black-box agent to a governed one — every decision sealed in a signed audit record. Observe every decision, replay any incident, and block a tool call against your own runtime rules before it executes. In plain language.",
});

export default function HowItWorks() {
  return (
    <>
      <Header />
      <PageJourney
        current="/how-it-works"
        why="Observe, Replay, Gate, Audit — the mechanism that turns a black-box agent into one you can prove."
        next={{ href: "/enterprise", label: "See it applied to regulated production" }}
      />

      {/* ── Hero ── */}
      <section className="hero">
        <div className="mk hero-grid hero-grid-raised">
          <div className="hero-copy">
            <span className="mk-eyebrow">How it works</span>
            <h1 className="hero-h1">
              From a black box you can&apos;t debug to one you can <span className="accent">re-run</span>.
            </h1>
            <p className="hero-lead">
              Runback keeps a signed record of everything an agent does — so you can
              reproduce any run, find what broke, and test a fix before release.
            </p>
          </div>
          <div className="hero-stack">
            <div className="hiw-steps">
              {([
                { n: "01", k: "Observe", label: "Capture every decision the model sees — context, tools, tokens, PII redacted.", tone: "brand" },
                { n: "02", k: "Replay", label: "Re-run from the exact captured context. A different output means behaviour changed.", tone: "brand2" },
                { n: "03", k: "Gate", label: "Simulate a policy against history. Enforce it live, block before it runs.", tone: "brand" },
                { n: "04", k: "Audit", label: "Export a tamper-evident, hash-chained record. Every decision provable.", tone: "brand2" },
              ] as { n: string; k: string; label: string; tone: string }[]).map((s) => (
                <div key={s.n} className="hiw-step">
                  <span className="hiw-n mono" data-tone={s.tone}>{s.n}</span>
                  <div>
                    <div className="hiw-k" data-tone={s.tone}>{s.k}</div>
                    <div className="hiw-label">{s.label}</div>
                  </div>
                </div>
              ))}
              <div className="hiw-compound-note">
                <span className="mono">→ Compounds:</span> every incident auto-mines into a regression test.
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* ── What changes ──
          Moved here from /why when that page was retired. It belongs ahead of
          the mechanism: a reader who does not yet know why reproducibility
          matters has no reason to care how it is achieved. */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow" data-tone="brand2">What changes</span>
          <h2 className="mk-h2">When you can reproduce any decision, three things change.</h2>
          <div className="why-changes">
            <div className="why-change">
              <div className="why-change-n mono">01</div>
              <div>
                <strong>Model upgrades become a diff, not a bet.</strong>{" "}
                Replay production decisions against the new model and compare the output before it ships.
              </div>
            </div>
            <div className="why-change">
              <div className="why-change-n mono">02</div>
              <div>
                <strong>Prompt iteration stops regressing.</strong>{" "}
                Every resolved incident becomes a test that blocks that specific failure from recurring.
              </div>
            </div>
            <div className="why-change">
              <div className="why-change-n mono">03</div>
              <div>
                <strong>Regulated deployment becomes day-one.</strong>{" "}
                The signed record builds from the first run — not retrofitted six months later.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 01 Observe ── */}
      <section className="mk-section" id="observe">
        <div className="mk">
          <div className="lc-head">
            <span className="lc-k mono">01 · Observe</span>
            <h2 className="mk-h2">See exactly what the model saw.</h2>
          </div>
          <p className="mk-lead mk-lead-gap-lg">
            Every step records the precise context the model was handed — system
            prompt, conversation, tools — captured at the model boundary, with PII
            redacted in-process. A failed run opens on the step that broke.{" "}
            <strong>Click any step:</strong>
          </p>
          <InteractiveTrace />
        </div>
      </section>

      {/* ── 02 Replay ── */}
      <section className="mk-section" id="replay">
        <div className="mk narrate">
          <div className="lc-head">
            <span className="lc-k mono">02 · Replay</span>
            <h2 className="mk-h2">Reproduce any decision — then find what changed it.</h2>
          </div>
          <p className="mk-lead mk-lead-gap-md">
            Re-execution holds tools, retrieval, and context fixed and runs the model fresh —
            a different output is signal, not a recording glitch. When something breaks,{" "}
            <strong>bisect</strong> the timeline to the exact change in log₂ tries.
          </p>
          <div className="demo-compare">
            <div className="demo-card" data-accent="true">
              <div className="demo-card-head"><span className="mono">Original · gpt-4o</span><span className="pill pill-success">pass</span></div>
              <p className="demo-text">Flagged the $85k application for human review — correctly applied the $50k limit.</p>
              <div className="demo-call mono" data-ok="true"><span className="g">→</span> route_to_review(&#123; reason: &quot;exceeds_auto_limit&quot; &#125;)</div>
            </div>
            <div className="demo-card" data-fail="true">
              <div className="demo-card-head"><span className="mono">Replay · gpt-4o-0513</span><span className="pill pill-error">regression</span></div>
              <p className="demo-text">Approved the same $85k application — ignored the $50k limit entirely.</p>
              <div className="demo-call mono" data-ok="false"><span className="g">→</span> issue_approval(&#123; amount: 85000 &#125;)</div>
            </div>
          </div>

          {/* Bisect, made concrete — "bisect... in log₂ tries" above was a
              bolded word with nothing behind it. This runs the real
              @runback/replay bisectCandidates() against a scripted history,
              same algorithm as /app/models/bisect, not a mockup of it. */}
          <p className="mk-lead mk-lead-gap-md" style={{ marginTop: "2.2rem" }}>
            12 revisions, one regression. <strong>Bisect</strong> finds it in 4 probes, not 12:
          </p>
          <BisectVisualizer />
          <p className="mk-lead" style={{ maxWidth: "62ch", fontSize: "0.88rem", marginTop: "1.2rem" }}>
            On a real run, each probe compares the model&apos;s decision — which tool, with what
            arguments — not tool or environment behavior. A regression caused by a changed tool
            response, not the model&apos;s choice, won&apos;t be found by this search.
          </p>
        </div>
      </section>

      {/* ── The outcome, concretely ──
          Recovered from /proof. The mechanism above is abstract until someone
          sees the same 2:47 AM incident resolved both ways. */}
      <section className="mk-section" id="incident">
        <div className="mk">
          <span className="mk-eyebrow" data-tone="brand2">One scenario, two outcomes</span>
          <h2 className="mk-h2">Hours of log archaeology, or minutes on the failing step.</h2>
          <p className="mk-lead" style={{ marginBottom: "2rem" }}>
            The same production failure, resolved with a log pipeline and with Runback.
            Not a customer story — the mechanism below is exactly what a real incident uses.
          </p>
          <IncidentCompare />
        </div>
      </section>

      {/* ── 03 Gate ── */}
      <section className="mk-section" id="gate">
        <div className="mk narrate">
          <div className="lc-head">
            <span className="lc-k mono">03 · Gate</span>
            <h2 className="mk-h2">Turn a fix into a guardrail — then enforce it live.</h2>
          </div>
          <p className="mk-lead mk-lead-gap-md">
            Save the step as an eval that must keep passing. <strong>Simulate</strong> a
            candidate policy against real history to see what it would have blocked, then{" "}
            <strong>enforce</strong> it in-process — blocked <em>before</em> it runs. A breach
            becomes a red row, never an incident.
          </p>
          <ul className="demo-eval demo-eval-sm">
            <li className="demo-eval-row" data-state="pass"><span className="demo-eval-glyph mono">✓</span><span className="demo-eval-label">refund within $100 limit</span><span className="demo-eval-state mono">pass</span></li>
            <li className="demo-eval-row" data-state="fail"><span className="demo-eval-glyph mono">✗</span><span className="demo-eval-label">disputed charge → must escalate</span><span className="demo-eval-state mono">fail</span></li>
            <li className="demo-eval-row" data-state="pass"><span className="demo-eval-glyph mono">✓</span><span className="demo-eval-label">out-of-scope → decline</span><span className="demo-eval-state mono">pass</span></li>
            <li className="demo-eval-row" data-state="pass"><span className="demo-eval-glyph mono">✓</span><span className="demo-eval-label">stays in policy tone</span><span className="demo-eval-state mono">pass</span></li>
          </ul>
          <div className="mono gate-result-note">3 / 4 passed — 1 regression caught before deploy</div>
        </div>
      </section>

      {/* ── 04 Audit ──
          Was one undifferentiated stack: lead → card → HashChainViz → lead →
          MerkleViz, all at the same visual weight under one heading — two
          genuinely distinct claims (a run seals itself; an org-wide ledger
          proves any run belongs to the log) read as one wall. Split into two
          named, separately-spaced sub-moments instead. */}
      <section className="mk-section" id="audit">
        <div className="mk narrate">
          <div className="lc-head">
            <span className="lc-k mono">04 · Audit</span>
            <h2 className="mk-h2">The cassette that sealed itself as it ran.</h2>
          </div>

          <div className="hiw-audit-sub">
            <span className="hiw-audit-sub-k mono">Per run</span>
            <p className="mk-lead mk-lead-gap-md">
              Export a complete, tamper-evident record of any run — every event in a
              SHA-256 hash chain, signed. Change one byte and verification fails. The
              artifact an auditor actually asks for.
            </p>
            <div className="hiw-audit-card">
              <div className="hiw-audit-row"><span className="mono k">$schema</span><span className="mono v">runback.audit/v2</span></div>
              <div className="hiw-audit-row"><span className="mono k">run_id</span><span className="mono v">support-refund-agent</span></div>
              <div className="hiw-audit-row"><span className="mono k">events</span><span className="mono v">6 · chained</span></div>
              <div className="hiw-audit-row"><span className="mono k">content_digest</span><span className="mono v">3e68cdbbf372df98…</span></div>
              <div className="hiw-audit-row"><span className="mono k">signature</span><span className="mono v">Ed25519 <span className="hiw-audit-sig">✓ signed</span></span></div>
              <div className="hiw-audit-foot mono">Recompute the chain to verify — POST to /api/audit/verify.</div>
            </div>

            {/* Merged from /depth, which said the same thing to nobody: the page
                was in neither the header nor the footer nor the sitemap, so these
                two diagrams — the only visual explanation of the chain and the
                Merkle tree anywhere on the site — were unreachable. */}
            <div className="hiw-chain-viz">
              <HashChainViz />
            </div>
          </div>

          <div className="hiw-audit-sub hiw-audit-sub-divider">
            <span className="hiw-audit-sub-k mono">Org-wide</span>
            <p className="mk-lead mk-lead-gap-md">
              Runs also seal into an org-wide ledger — one signed root proves any run is in
              the log, without handing over the rest.
            </p>
            <div className="hiw-chain-viz">
              <MerkleViz />
            </div>
          </div>
        </div>
      </section>

      {/* ── Compound — the effect of the 4 steps repeating, not a 5th step ── */}
      <section className="mk-section">
        <div className="mk narrate">
          <div className="lc-head">
            <span className="lc-k mono">Then it compounds</span>
            <h2 className="mk-h2">Every incident becomes a permanent test.</h2>
          </div>
          <p className="mk-lead">
            A run that breaches policy or errors auto-enrolls as a <strong>golden test</strong> —
            deduped, so each distinct failure is one test that grows your suite by itself.
          </p>
          <p className="mk-lead mk-lead-top">
            A daily job goes further: it takes each real failure and asks a model to probe
            the same weak spot from a different angle. Every proposal lands as pending —
            never auto-approved — until a human reviews it.
          </p>
          <ul className="demo-eval demo-eval-sm hiw-compound-list">
            <li className="demo-eval-row" data-state="pass"><span className="demo-eval-glyph mono">✓</span><span className="demo-eval-label mono">loan-over-50k-policy-block</span><span className="demo-eval-state mono">pass</span></li>
            <li className="demo-eval-row" data-state="pass"><span className="demo-eval-glyph mono">✓</span><span className="demo-eval-label mono">dispute-refund-must-escalate</span><span className="demo-eval-state mono">pass</span></li>
            <li className="demo-eval-row" data-state="pass"><span className="demo-eval-glyph mono">✓</span><span className="demo-eval-label mono">pii-not-forwarded-to-tool</span><span className="demo-eval-state mono">pass</span></li>
            <li className="demo-eval-row" data-state="pass"><span className="demo-eval-glyph mono">✓</span><span className="demo-eval-label mono">concurrent-session-isolation</span><span className="demo-eval-state mono">pass <span className="demo-eval-new">← sealed today</span></span></li>
          </ul>
          <p className="mk-lead mk-lead-top">
            {/* Same-page anchor — plain <a>, not next/link (see Header.tsx): a
                Link to the current route with only a new hash measured the
                scroll target before the page's client components settled
                layout and landed ~3500px off, reproduced live. */}
            <a href="#incident" className="mk-link">Walk the loan-approval-agent incident — all 5 steps, the policy block, the cassette →</a>
          </p>
        </div>
      </section>

      {/* ── How the data reaches Runback ── */}
      {/* ── Why this cannot be retrofitted ──
          From /why. Placed after the mechanism deliberately: read before it,
          this is a claim; read after, it is the conclusion. */}
      <div id="moats">
        <Moats />
      </div>

      <section className="mk-section" id="data-flow">
        <div className="mk">
          <span className="mk-eyebrow">Where the data lives</span>
          <h2 className="mk-h2">Your agent runs in your app. So how does Runback see it?</h2>
          <p className="mk-lead mk-lead-gap-xs">
            Your model calls happen inside your own application. Hook it up{" "}
            <strong>once</strong>; everything else runs on the trace it produces.
          </p>
          <div className="flow">
            <div className="flow-stage" data-tone="brand">
              <span className="fs-k">1 · Your agent</span>
              <h4>Instrument once</h4>
              <p>A ~3-line SDK wrap or your existing OpenTelemetry traces. A <strong>post-hook</strong> — your real model call runs untouched.</p>
              <pre className="flow-stage-code">{`const dbg = withDebugger(model)
const res = await generateText({
  model: dbg.model,
})
await dbg.finish({
  status: "success",
})`}</pre>
              <div className="flow-tags"><span>SDK</span><span>Proxy</span><span>OpenTelemetry</span></div>
            </div>
            <span className="flow-arrow" aria-hidden>→</span>
            <div className="flow-stage" data-tone="brand2">
              <span className="fs-k">2 · In your process</span>
              <h4>Redact before egress</h4>
              <p>Secrets, keys, emails, card numbers and SSNs are scrubbed before a trace is sent anywhere.</p>
            </div>
            <span className="flow-arrow" aria-hidden>→</span>
            <div className="flow-stage" data-tone="brand">
              <span className="fs-k">3 · Your store</span>
              <h4>Land in a store you own</h4>
              <p>Postgres you control — self-hosted or our managed cloud. Delete a run and it&apos;s gone.</p>
            </div>
            <span className="flow-arrow" aria-hidden>→</span>
            <div className="flow-stage" data-tone="brand2">
              <span className="fs-k">4 · On the trace</span>
              <h4>Replay · Evals · Audit</h4>
              <p>Every feature reads the same captured trace. No extra wiring, no second integration.</p>
            </div>
          </div>
          <p className="flow-note">
            Replay and evals re-execute a step, so they use a model key configured
            server-side. Observe, time-travel, and audit need no model key at all.
          </p>
        </div>
      </section>

      {/* ── Connect your agent ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow" data-tone="brand2">Connect your agent</span>
          <h2 className="mk-h2">About three lines, any agent.</h2>
          <p className="mk-lead mk-lead-gap-sm">
            Use the SDK for the deepest capture, or point existing OpenTelemetry
            traces at Runback — it sits above whatever framework you build in.
          </p>
          <pre className="mk-code">
            <code>{`import { withDebugger } from "@runback/sdk";
import { generateText, stepCountIs } from "ai";

const dbg = withDebugger(model, { runName: "support-agent", redact: "standard" });
const res = await generateText({
  model: dbg.model,
  tools: dbg.tools(myTools),
  stopWhen: stepCountIs(8),
  prompt: task,
});
await dbg.finish({ output: res.text, status: "success" });`}</code>
          </pre>
          <p className="mk-lead mk-lead-top">
            Every run now shows up ready to observe, replay, gate, and audit.{" "}
            <Link href="/docs#sdk-langchain" className="mk-link" scroll={false}>See all integrations →</Link>
          </p>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>The fastest way to get it is to open a run.</h2>
          <p>Walk a real failing run step by step — no signup.</p>
          <div className="hero-cta hero-cta-center">
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <Link href="/runs" className="btn-line">Open a demo run</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
