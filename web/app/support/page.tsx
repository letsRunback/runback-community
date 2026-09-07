import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/support",
  title: "Support & SLAs",
  description:
    "How to get help with Runback — support channels, response-time targets by plan, severity-based SLAs for Enterprise, and the managed-cloud uptime commitment.",
});

export default function Support() {
  return (
    <>
      <Header />

      {/* ── Hero ── */}
      <section className="hero">
        <div className="mk" style={{ position: "relative", zIndex: 1, paddingTop: "1rem", paddingBottom: "1rem" }}>
          <span className="mk-eyebrow">Support &amp; SLAs</span>
          <h1 className="hero-h1" style={{ maxWidth: "20ch" }}>
            Real people, defined response times.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>
            No ticket black holes. Here&apos;s exactly how to reach us, what to
            expect by plan, and the SLAs we commit to in writing on Enterprise.
          </p>
          <div className="hero-cta">
            <Link href="/contact" className="btn-fill">Contact support →</Link>
            <a href="mailto:support@runback.dev" className="btn-line">support@runback.dev</a>
          </div>
        </div>
      </section>

      {/* ── Tiers ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">By plan</span>
          <h2 className="mk-h2">What support looks like on each plan.</h2>
          <div className="sla-grid">
            <div className="sla-card">
              <span className="sla-k mono">Community</span>
              <h3>Free</h3>
              <ul>
                <li>Docs, the Community edition, and email best-effort</li>
                <li>Report bugs &amp; request features by email</li>
                <li>No response-time guarantee</li>
              </ul>
            </div>
            <div className="sla-card">
              <span className="sla-k mono">Pro</span>
              <h3>Priority</h3>
              <ul>
                <li>Priority email support</li>
                <li>Next-business-day response target</li>
                <li>Business hours, your primary region</li>
                <li>Help with setup, upgrades &amp; integration</li>
              </ul>
            </div>
            <div className="sla-card" data-feature>
              <span className="sla-k mono">Enterprise</span>
              <h3>Named + SLA</h3>
              <ul>
                <li>Named contact &amp; shared Slack channel</li>
                <li>Severity-based SLAs (below), 24×7 for Sev 1</li>
                <li>Managed-cloud uptime commitment</li>
                <li>We join your security &amp; architecture reviews</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── SLA table ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Enterprise SLAs</span>
          <h2 className="mk-h2">Response targets, by severity.</h2>
          <p className="mk-lead" style={{ marginBottom: "1.4rem" }}>
            Target first-response times for Enterprise. The exact figures are
            confirmed in your order form or MSA and can be tuned to your risk
            requirements.
          </p>
          <p className="table-scroll-hint mono">Swipe to see all columns →</p>
          <div className="legal table-scroll" style={{ maxWidth: "100%", padding: 0 }}>
            <table>
              <thead>
                <tr><th>Severity</th><th>Definition</th><th>Response target</th><th>Coverage</th></tr>
              </thead>
              <tbody>
                <tr><td><strong>Sev 1 — Critical</strong></td><td>Production down or a confirmed security incident.</td><td>1 hour</td><td>24×7</td></tr>
                <tr><td><strong>Sev 2 — Major</strong></td><td>Major feature degraded, no reasonable workaround.</td><td>4 business hours</td><td>Business hours</td></tr>
                <tr><td><strong>Sev 3 — Minor</strong></td><td>Minor issue, question, or a workaround exists.</td><td>1 business day</td><td>Business hours</td></tr>
                <tr><td><strong>Sev 4 — Request</strong></td><td>Feature request or general guidance.</td><td>2 business days</td><td>Business hours</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Uptime & status ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Managed cloud</span>
          <h2 className="mk-h2">Uptime &amp; status.</h2>
          <div className="cap-grid">
            <div className="cap">
              <div className="cap-k mono">99.9% uptime target</div>
              <p>Our managed cloud targets 99.9% monthly availability for Enterprise, with service credits defined in your agreement. Self-host availability is yours to operate — the stack is a standard Next.js app and Postgres.</p>
            </div>
            <div className="cap">
              <div className="cap-k mono">Status &amp; incidents</div>
              <p>We post incidents and maintenance windows and notify affected customers directly. Subscribe by emailing <a href="mailto:support@runback.dev" style={{ color: "var(--brand)" }}>support@runback.dev</a>.</p>
            </div>
            <div className="cap">
              <div className="cap-k mono">Security issues</div>
              <p>Report vulnerabilities to <a href="mailto:security@runback.dev" style={{ color: "var(--brand)" }}>security@runback.dev</a> — see the <Link href="/security" style={{ color: "var(--brand)" }}>security page</Link> for our disclosure terms.</p>
            </div>
            <div className="cap">
              <div className="cap-k mono">Self-host help</div>
              <p>Running it yourself? The setup guide on <Link href="/how-it-works" style={{ color: "var(--brand)" }}>how it works</Link> and the repo docs cover deployment; Pro &amp; Enterprise add hands-on help.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>Need a hand, or a signed SLA?</h2>
          <p>Email support for help today, or talk to us about an Enterprise agreement with named support.</p>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <a href="mailto:support@runback.dev" className="btn-fill">Email support →</a>
            <Link href="/contact" className="btn-line">Talk about Enterprise</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
