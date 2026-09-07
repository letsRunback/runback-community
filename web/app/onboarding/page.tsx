import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import PageJourney from "@/components/site/PageJourney";
import { PLAN_INFO } from "@/lib/plans";
import { pageMetadata } from "@/lib/seo";
import { PRICING_HREF } from "@/lib/edition";

export const metadata = pageMetadata({
  path: "/onboarding",
  title: "Onboarding — the rollout from one agent to a governed fleet",
  description:
    "What actually happens after you sign up: Day 1, Week 1, Month 1, and steady state — the rollout a CTO can hand to their own team.",
});

const TIMELINE = [
  {
    n: "01",
    when: "Day 1",
    title: "One agent, wrapped and captured.",
    body:
      "Create a workspace (managed cloud, five minutes — or self-host free) and wrap your riskiest agent with the SDK: about three lines around your existing model call, no migration. The next request it makes shows up in Overview as a real captured run — context, tool calls, tokens — in under 100ms of the SDK sending it. Open it and replay it once, so the team sees the mechanism, not a slide about it.",
    tone: "brand",
  },
  {
    n: "02",
    when: "Week 1",
    title: "The team gets in, not just you.",
    body:
      "Invite the engineers who actually own the agents — RBAC roles (below) mean an auditor or a stakeholder can get read-only access without also getting the ability to change a policy. Wrap two or three more agents. Turn on alerting so a failure surfaces in Slack or email instead of waiting for someone to check the dashboard.",
    tone: "brand2",
  },
  {
    n: "03",
    when: "Month 1",
    title: "Your first incident becomes a permanent guardrail.",
    body:
      "Take the first real failure the team hit and do two things with it: write the policy that would have caught it as a gate that runs before the call, and enroll the run as a golden-corpus regression test so the same failure can't silently come back after the next prompt change. Wire the eval suite into CI so a regression blocks a deploy instead of reaching production.",
    tone: "brand",
  },
  {
    n: "04",
    when: "Ongoing",
    title: "Steady state — proof on demand, not a scramble.",
    body:
      "Replay 90 days of real decisions against any model upgrade before you ship it, so drift shows up as a diff you review, not an incident you explain. Export a signed audit record whenever compliance, security, or a regulator asks — verifiable independently, without a Runback account. At multi-team scale, the fleet dashboard gives leadership one view instead of N dashboards.",
    tone: "brand2",
  },
] as const;

const ROLES = [
  { role: "Owner", does: "Billing, org settings, who else is Owner or Admin. Usually the person who signed up." },
  { role: "Admin", does: "Invites the team, authors policy gates, manages plan and integrations." },
  { role: "Member", does: "Wraps agents, reads runs, replays, and enrolls incidents — the day-to-day engineering seat." },
  { role: "Viewer", does: "Read-only. The seat for an auditor, a compliance stakeholder, or a manager who needs visibility, not access." },
] as const;

export default function Onboarding() {
  return (
    <>
      <Header />
      <PageJourney
        current="/onboarding"
        why="The rollout from one wrapped agent to a governed fleet — the plan you can hand to your own team."
        next={{ href: "/docs", label: "Start integrating — the docs" }}
      />

      {/* Hero */}
      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Onboarding</span>
          <h1 className="hero-h1" style={{ maxWidth: "24ch" }}>
            From one wrapped agent to a governed fleet.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>
            What actually happens after you sign up — not a vague promise
            about &quot;time to value,&quot; but the specific path from a
            single instrumented agent to a team that can answer an
            auditor&apos;s question without a war room.
          </p>
          <div className="hero-cta">
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <Link href="/demo" className="btn-line">Talk through a team rollout →</Link>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">The rollout</span>
          <h2 className="mk-h2">Four stages. Nothing skipped, nothing assumed.</h2>
          <div style={{ display: "grid", gap: "1rem", marginTop: "2rem" }}>
            {TIMELINE.map((t) => (
              <div key={t.n} className="card" style={{ padding: "1.5rem 1.75rem", display: "grid", gridTemplateColumns: "auto 1fr", gap: "1.4rem", alignItems: "start" }}>
                <div style={{ textAlign: "center", minWidth: "5rem" }}>
                  <div className="mono" style={{ fontSize: "1.4rem", fontWeight: 700, color: `var(--${t.tone})` }}>{t.n}</div>
                  <div className="mono" style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "0.2rem" }}>{t.when}</div>
                </div>
                <div>
                  <h3 style={{ fontSize: "1.15rem", letterSpacing: "-0.02em", margin: "0 0 0.5rem" }}>{t.title}</h3>
                  <p style={{ fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.65, margin: 0 }}>{t.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team roles */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Who does what</span>
          <h2 className="mk-h2">Real RBAC roles — not everyone needs write access to onboard.</h2>
          <p className="mk-lead" style={{ marginBottom: "1.6rem" }}>
            Available from Starter and up. This is how a CTO uplifts a team
            without handing every stakeholder the same keys.
          </p>
          <div className="table-scroll">
            <table className="ptab ptab-prose">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>What they can do</th>
                </tr>
              </thead>
              <tbody>
                {ROLES.map((r) => (
                  <tr key={r.role}>
                    <td className="mono">{r.role}</td>
                    <td>{r.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* What unlocks at each stage — derived from the single source of truth in lib/plans, never hand-typed */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">What unlocks as you grow</span>
          <h2 className="mk-h2">The rollout maps onto plan tiers — you don&apos;t buy ahead of where you are.</h2>
          <div style={{ display: "grid", gap: "0.9rem", marginTop: "1.8rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {([PLAN_INFO.starter, PLAN_INFO.growth, PLAN_INFO.scale, PLAN_INFO.enterprise]).map((p) => (
              <div key={p.key} className="card" style={{ padding: "1.3rem 1.4rem" }}>
                <div className="mono" style={{ fontSize: "0.95rem", color: "var(--brand)" }}>{p.name}</div>
                <p style={{ fontSize: "0.86rem", color: "var(--text-secondary)", lineHeight: 1.55, margin: "0.4rem 0 0" }}>{p.tagline}</p>
              </div>
            ))}
          </div>
          <p className="mk-lead" style={{ marginTop: "1.4rem" }}>
            <Link href={PRICING_HREF} className="mk-link">See the full feature breakdown per tier →</Link>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>Ready to start the rollout with your team?</h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: "48ch", margin: "0.75rem auto 0" }}>
            Start free today, or book a call and we&apos;ll walk through the
            rollout live against your actual agents.
          </p>
          <div className="hero-cta hero-cta-center" style={{ marginTop: "1.5rem" }}>
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <Link href="/demo" className="btn-line">Book a call →</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
