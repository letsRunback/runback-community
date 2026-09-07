import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { PLAN_INFO } from "@/lib/plans";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/press",
  title: "Press kit",
  description:
    "Press kit and editorial contacts for Runback — the system of record for AI agent decisions.",
});

const FACTS = [
  ["Founded", "2025"],
  ["Headquartered", "Remote"],
  ["Category", "AI agent governance — observe, replay, gate, audit"],
  ["Deployment", "Managed cloud · Self-hosted in your VPC"],
  ["Compliance", "EU AI Act Art. 12 · APRA CPS 230 · NIST AI RMF · ISO/IEC 42001"],
  ["Pricing", `Free self-hosted · Starter ${PLAN_INFO.starter.priceLabel} · Growth ${PLAN_INFO.growth.priceLabel} · Scale ${PLAN_INFO.scale.priceLabel} · Pro ${PLAN_INFO.pro.priceLabel} · Enterprise custom`],
  ["Press contact", "press@runback.dev"],
];

export default function Press() {
  return (
    <>
      <Header />

      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Press kit</span>
          <h1 className="hero-h1" style={{ maxWidth: "22ch" }}>
            The <span className="accent">system of record</span> for AI agent decisions.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "58ch" }}>
            Every AI agent in production makes decisions that companies will have to prove.
            Runback is the first platform that makes any decision re-executable, auditable, and signed.
          </p>
          <div className="hero-cta">
            <a href="mailto:press@runback.dev?subject=Press+inquiry" className="btn-fill">press@runback.dev →</a>
            <Link href="/security" className="btn-line">Security &amp; trust →</Link>
          </div>
        </div>
      </section>

      {/* Fast facts as chips, not a flat key/value list — a reader scanning
          for one fact (funding stage, pricing) shouldn't have to read the
          whole column top to bottom. */}
      <section className="mk-section">
        <div className="mk">
          <div className="reg-chip-row">
            {FACTS.map(([k, v]) => (
              <span key={k} className="reg-chip"><strong>{k}:</strong>&nbsp;{v}</span>
            ))}
          </div>
        </div>
      </section>

      {/* One paragraph */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Boilerplate</span>
          <h2 className="mk-h2">One paragraph.</h2>
          <div style={{ padding: "1.4rem 1.6rem", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, maxWidth: 680, marginTop: "1rem" }}>
            <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", lineHeight: 1.7, margin: 0 }}>
              Runback is the system of record for AI agent decisions — the first platform that
              captures every model call, tool use, and reasoning step, then re-executes any of them
              deterministically from the exact captured context. Teams use it to reproduce incidents
              in under 5 minutes, gate every model or prompt change in CI, and export a tamper-evident
              audit artifact mapping to EU AI Act, APRA CPS 230, and NIST AI RMF requirements. The
              platform runs fully inside the customer&apos;s perimeter on Enterprise.
            </p>
          </div>
        </div>
      </section>

      {/* Verifiable claims */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Verifiable claims</span>
          <h2 className="mk-h2">Check everything we say.</h2>
          <div className="faq" style={{ marginTop: "1.2rem" }}>
            <div className="faq-q">
              <h4>3h 48m → 4m 23s MTTR</h4>
              <p>A worked reference scenario, not a customer case study — we&apos;re too early to have one. Loan-approval agent, run_a3f1b90c, same mechanism a real incident uses. Walk it live at <Link href="/how-it-works" style={{ color: "var(--brand)" }}>runback.dev/how-it-works</Link>.</p>
            </div>
            <div className="faq-q">
              <h4>6-layer determinism substrate, proven in public CI</h4>
              <p>The replay oracle&apos;s proof run is public — inspect it yourself. <a href="https://github.com/letsRunback/runback-proofs/actions" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>See the actions ↗</a></p>
            </div>
            <div className="faq-q">
              <h4>EU AI Act claim</h4>
              <p>Article 12 is in force. <a href="https://artificialintelligenceact.eu/article/12/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>Read it ↗</a></p>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-cta-band">
        <div className="mk">
          <h2>Press contact.</h2>
          <p>Embargoed briefings, interview requests, or brand assets — <a href="mailto:press@runback.dev" style={{ color: "var(--brand)" }}>press@runback.dev</a>. One business day response.</p>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <a href="mailto:press@runback.dev?subject=Press+inquiry" className="btn-fill">press@runback.dev →</a>
            <Link href="/security" className="btn-line">Security &amp; trust</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
