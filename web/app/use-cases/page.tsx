import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import PageJourney from "@/components/site/PageJourney";
import IncidentCompare from "@/components/site/IncidentCompare";
import { pageMetadata } from "@/lib/seo";
import ScenarioSwitcher from "@/components/site/ScenarioSwitcher";
import { PRICING_HREF } from "@/lib/edition";

export const metadata = pageMetadata({
  path: "/use-cases",
  title: "Use cases — what problem Runback actually solves",
  description:
    "Not a dashboard demo — the end-to-end problem Runback solves, from a solo engineer debugging a 2 AM failure to a regulated enterprise proving control of its agent fleet.",
});

export default function UseCases() {
  return (
    <>
      <Header />
      <PageJourney
        current="/use-cases"
        why="The problems Runback exists to solve — at startup stakes and at enterprise stakes, end to end."
        next={{ href: "/how-it-works", label: "See the mechanism behind these" }}
      />

      {/* Hero */}
      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Use cases</span>
          <h1 className="hero-h1" style={{ maxWidth: "22ch" }}>
            What problem does this actually solve — end to end?
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>
            Runback exists for one moment: the one where you have to
            reproduce, defend, or stop an agent decision — not admire a
            dashboard. Below is what that moment looks like in practice, and
            who it costs the most when there&apos;s no answer for it.
          </p>
          <div className="hero-cta">
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <Link href="/onboarding" className="btn-line">See what happens after you buy →</Link>
          </div>
        </div>
      </section>

      {/* Startup vs enterprise framing */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Is this a startup problem or an enterprise problem?</span>
          <h2 className="mk-h2">Both — the same missing primitive, different stakes.</h2>
          <div className="sec-plain-compare">
            <div className="sec-plain-col" data-tone="rose">
              <div className="sec-plain-hd">Seed-stage team</div>
              <p style={{ fontSize: "0.86rem", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                The missing primitive costs an engineer a bad night: &quot;why did
                the agent do that at 2 AM&quot; with no way to answer it except
                staring at logs.
              </p>
            </div>
            <div className="sec-plain-col" data-tone="emerald">
              <div className="sec-plain-hd">Regulated enterprise</div>
              <p style={{ fontSize: "0.86rem", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                The exact same gap — no re-executable record of what the model
                saw and decided — becomes an unanswerable question from an
                auditor, a board, or a court.
              </p>
            </div>
          </div>

          <p className="mk-lead" style={{ marginTop: "1.8rem", marginBottom: "0.9rem" }}>
            Four failure classes show up at every scale. None are visible in a log. All are visible in a replay.
          </p>
          <div className="uc-failure-grid">
            {[
              { name: "Policy violation", detail: "The rule existed, the model ignored it." },
              { name: "Context contamination", detail: "Retrieval skewed the decision." },
              { name: "Prompt injection", detail: "User input overrode the system prompt." },
              { name: "Model drift", detail: "A silent upstream update shifted behaviour." },
            ].map((f) => (
              <div className="uc-failure-card" key={f.name}>
                <span className="uc-failure-dot" />
                <div>
                  <div className="uc-failure-name">{f.name}</div>
                  <div className="uc-failure-detail">{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* End-to-end scenarios — real, interactive demos, not description */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">End to end</span>
          <h2 className="mk-h2">Three ways this shows up in production — click through each one.</h2>
          <p className="mk-lead" style={{ marginBottom: "0.6rem" }}>
            These are the same live demos used elsewhere on the site, not
            screenshots — we&apos;re early enough that we&apos;d rather show
            you the real mechanism than dress up a case study we don&apos;t
            have yet.
          </p>
        </div>

        {/* 1. Incident → root cause */}
        <div className="mk" style={{ marginTop: "2.6rem" }}>
          <span className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand)" }}>
            Incident → root cause
          </span>
          <h3 style={{ fontSize: "1.3rem", letterSpacing: "-0.02em", margin: "0.5rem 0 0.7rem" }}>
            An agent does something wrong and nobody can say why.
          </h3>
          <p style={{ fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: "68ch", marginBottom: "1.4rem" }}>
            loan-approval-agent auto-approves a loan it should have escalated.
            The only record is a log line: &quot;approved, 2:47 AM.&quot;
            Below is an illustrative before/after from the incident walkthrough —
            a worked example, not a customer story. We are too early to have one.
          </p>
        </div>
        <div className="mk"><IncidentCompare /></div>
        <div className="mk" style={{ marginTop: "0.9rem" }}>
          <Link href="/how-it-works#incident" className="mk-link" scroll={false} style={{ fontSize: "0.88rem" }}>
            Walk this exact scenario, step by step →
          </Link>
        </div>

        {/* 2. Prevention → policy gate */}
        <div className="mk" style={{ marginTop: "3.2rem" }}>
          <span className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand-2)" }}>
            Prevention → policy gate
          </span>
          <h3 style={{ fontSize: "1.3rem", letterSpacing: "-0.02em", margin: "0.5rem 0 0.7rem" }}>
            A rule everyone agreed on gets violated in production anyway.
          </h3>
          <p style={{ fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: "68ch", marginBottom: "1.4rem" }}>
            A limit written into the system prompt is advisory, not enforced —
            the model can decide to break it anyway. Pick the world closest to
            yours, then click through the run: the gate catches it before the
            call reaches anyone.
          </p>
        </div>
        <div className="mk"><ScenarioSwitcher /></div>

        {/* 3. Change management → drift */}
        <div className="mk" style={{ marginTop: "3.2rem" }}>
          <span className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand)" }}>
            Change management → model drift
          </span>
          <h3 style={{ fontSize: "1.3rem", letterSpacing: "-0.02em", margin: "0.5rem 0 0.7rem" }}>
            You want to upgrade the model. You don&apos;t know what it&apos;ll break.
          </h3>
          <p style={{ fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: "68ch", marginBottom: "1.4rem" }}>
            The same captured context from the run above, replayed against
            two other models before anyone ships an upgrade. Same input,
            same tools — different output means behaviour changed.
          </p>
          <div className="card" style={{ padding: "1.4rem 1.6rem", maxWidth: "560px" }}>
            <div className="mono" style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", marginBottom: "0.9rem" }}>
              support-agent · refund · replayed against 3 candidate models
            </div>
            <div className="ent-hw-preview">
              <div className="ent-hw-cmp" data-result="pass">
                <span className="ent-hw-cmodel">claude-sonnet-4.5 (current)</span>
                <span className="ent-hw-caction">→ escalate(dispute)</span>
                <span className="pill pill-success">baseline</span>
              </div>
              <div className="ent-hw-cmp" data-result="pass">
                <span className="ent-hw-cmodel">gpt-4o</span>
                <span className="ent-hw-caction">→ escalate(dispute)</span>
                <span className="pill pill-success">match</span>
              </div>
              <div className="ent-hw-cmp" data-result="fail">
                <span className="ent-hw-cmodel">llama-3.3</span>
                <span className="ent-hw-caction">→ issue_refund(250)</span>
                <span className="pill pill-error">regression</span>
              </div>
            </div>
          </div>
          <Link href="/how-it-works" className="mk-link" style={{ display: "inline-block", marginTop: "1rem", fontSize: "0.88rem" }}>
            See replay in the mechanism guide →
          </Link>
        </div>
      </section>

      {/* By where you are */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">By where you are</span>
          <h2 className="mk-h2">The same four capabilities, applied to your actual stakes.</h2>
          <div className="seg-short-grid">
            <div className="seg-short">
              <span className="seg-label mono" data-tone="brand">Early-stage AI team</span>
              <p>
                Week 1: wrap your riskiest agent, replay your first real
                failure instead of guessing at it. By month one, every
                incident auto-mines into a regression test, so the same bug
                can&apos;t silently come back after a prompt change.
              </p>
              <Link href="/onboarding" className="seg-link mono">See the rollout →</Link>
            </div>
            <div className="seg-short">
              <span className="seg-label mono" data-tone="brand2">Banks &amp; financial institutions</span>
              <p>
                Every decision sealed in a tamper-evident chain, self-hosted
                in your own VPC. APRA CPS 230, EU AI Act Art. 12, NIST AI
                RMF — one record, reviewed by your risk committee, not
                three separate log exports.
              </p>
              <Link href="/enterprise" className="seg-link mono">Enterprise &amp; compliance →</Link>
            </div>
            <div className="seg-short">
              <span className="seg-label mono" data-tone="brand">Law firms &amp; professional services</span>
              <p>
                Every AI session captured and sealed the moment it happens.
                Replay the exact session for a partner, a court, or a
                regulator. Policy gates flag a high-risk output before it
                reaches a client.
              </p>
              <Link href="/enterprise" className="seg-link mono">Governance for legal →</Link>
            </div>
            <div className="seg-short">
              <span className="seg-label mono" data-tone="brand2">Safety-critical deployments</span>
              <p>
                Policy gates run before the call, not after the incident
                report. The block is sealed into the record automatically —
                so &quot;we prevented it&quot; is something you can show,
                not something you have to be believed about.
              </p>
              <Link href="/how-it-works" className="seg-link mono">How it works →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>See what buying actually gets you.</h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: "48ch", margin: "0.75rem auto 0" }}>
            The rollout from a single wrapped agent to a governed fleet — the
            journey a CTO can hand to their own team.
          </p>
          <div className="hero-cta hero-cta-center" style={{ marginTop: "1.5rem" }}>
            <Link href="/onboarding" className="btn-fill">See the onboarding journey →</Link>
            <Link href={PRICING_HREF} className="btn-line">Pricing →</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
