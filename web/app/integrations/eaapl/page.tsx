import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/integrations/eaapl",
  title: "EAAPL integration",
  description:
    "Expose Runback's live regulatory-control mapping — EU AI Act, ISO 42001, NIST AI RMF, APRA CPS 230 — to EAAPL's evidence pack through a scoped, read-only key.",
});

export default function EaaplIntegration() {
  return (
    <>
      <Header />

      {/* ── Hero ── */}
      <section className="hero">
        <div className="mk hero-grid">
          <div className="hero-copy">
            <span className="mk-eyebrow">Integrations · Regulatory evidence</span>
            <h1 className="hero-h1">
              Turn your control mapping into an <span className="accent">evidence pack</span>.
            </h1>
            <p className="hero-lead">
              Runback already computes live, per-control status against EU AI Act, ISO 42001,
              NIST AI RMF, and APRA CPS 230 from your actual run data — the same dashboard your
              team uses today. This integration exposes that same data to EAAPL through a
              separate, read-only key, so its evidence pack reflects a verified status instead of
              a self-reported checkbox.
            </p>
            <div className="hero-cta">
              <Link href="/app/settings" className="btn-fill">Generate a compliance key →</Link>
              <Link href="/enterprise" className="btn-line">See the audit model →</Link>
            </div>
            <div className="hero-meta">
              <span>Maps to</span>
              <code>APRA CPS 230</code>
              <code>EU AI Act Art. 12</code>
              <code>ISO 42001</code>
              <code>NIST AI RMF</code>
            </div>
          </div>
        </div>
      </section>

      {/* ── Flow ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">How it flows</span>
          <h2 className="mk-h2">One read-only pull. Same data, narrower key.</h2>
          <div className="arch" style={{ marginTop: "2rem" }}>
            <div className="arch-col">
              <span className="arch-k">Runback</span>
              <span className="arch-chip">Regulatory dashboard</span>
              <span className="arch-chip">per-control status</span>
              <span className="arch-chip">computed from live run data</span>
            </div>
            <div className="arch-arrow">→</div>
            <div className="arch-col">
              <span className="arch-k">Scoped key</span>
              <div className="arch-pipe">compliance_read only<br />no ingest, no run content</div>
            </div>
            <div className="arch-arrow">→</div>
            <div className="arch-runback">
              <div className="name">EAAPL</div>
              <div className="arch-caps">
                <span className="arch-cap">Evidence pack</span>
                <span className="arch-cap">APRA export</span>
              </div>
            </div>
          </div>
          <p className="mk-lead" style={{ marginTop: "1.8rem" }}>
            The <code>compliance_read</code> key is deliberately narrower than the ingest key your
            agents use — it resolves to exactly one endpoint and returns only control status,
            coverage counts, and evidence links. It cannot ingest, and it never sees a prompt, a
            tool payload, or customer data. Generate one from Settings (Enterprise plans) and hand
            it to EAAPL instead of your ingest key.
          </p>
        </div>
      </section>

      {/* ── What crosses the wire ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">What crosses the wire</span>
          <h2 className="mk-h2">Control status, never raw runs.</h2>
          <div className="ent-perimeter-cards">
            <div className="ent-perimeter-card">
              <div className="ent-pc-accent" data-tone="brand" />
              <div>
                <div className="ent-pc-k">Per-control status</div>
                <div className="ent-pc-v">Compliant / partial / not started for every mapped control, computed live from the last 90 days of run data.</div>
              </div>
            </div>
            <div className="ent-perimeter-card">
              <div className="ent-pc-accent" data-tone="brand2" />
              <div>
                <div className="ent-pc-k">Framework coverage</div>
                <div className="ent-pc-v">A rolled-up coverage percentage per framework, alongside the individual control breakdown.</div>
              </div>
            </div>
            <div className="ent-perimeter-card">
              <div className="ent-pc-accent" data-tone="brand" />
              <div>
                <div className="ent-pc-k">Evidence counts</div>
                <div className="ent-pc-v">How many policy blocks, ledger entries, or runs back each control — not the underlying content.</div>
              </div>
            </div>
            <div className="ent-perimeter-card">
              <div className="ent-pc-accent" data-tone="brand2" />
              <div>
                <div className="ent-pc-k">Evidence links</div>
                <div className="ent-pc-v">A deep link into the dashboard for each control — today these require a Runback session to open; a publicly verifiable link is on the roadmap.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Control mapping ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Control mapping</span>
          <h2 className="mk-h2">What Runback already tracks for APRA CPS 230.</h2>
          <div className="table-scroll">
            <table className="ptab">
              <thead>
                <tr>
                  <th>Runback capability</th>
                  <th>CPS 230 control</th>
                  <th>Evidence type</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono">Alert rules + audit ledger</td>
                  <td>Incident identification &amp; escalation</td>
                  <td className="mono">ledger</td>
                </tr>
                <tr>
                  <td className="mono">Signed, hash-chained audit trail</td>
                  <td>Incident recording</td>
                  <td className="mono">audit_log</td>
                </tr>
                <tr>
                  <td className="mono">Policy engine fail-open/fail-closed</td>
                  <td>Business continuity — critical operations</td>
                  <td className="mono">policy_block</td>
                </tr>
                <tr>
                  <td className="mono">Compliance report export</td>
                  <td>Operational risk review &amp; reporting</td>
                  <td className="mono">report</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="empty" style={{ marginTop: "1rem", fontSize: "0.88rem" }}>
            Same underlying mapping used in the in-app Regulatory dashboard — nothing computed
            twice, nothing EAAPL-specific about the numbers themselves.
          </p>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>Stop self-reporting the controls you can prove.</h2>
          <p>The key exists today — generate one from Settings. EAAPL&apos;s side of the pull is rolling out to design partners first; tell us about your setup and we&apos;ll get you connected.</p>
          <div className="hero-cta hero-cta-center">
            <Link href="/app/settings" className="btn-fill">Generate a compliance key →</Link>
            <Link href="/contact" className="btn-line">Ask about EAAPL setup →</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
