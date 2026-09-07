import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";
import { CAIQ, regulatoryMapping } from "@/lib/trustCenter";

export const metadata = pageMetadata({
  path: "/procurement",
  title: "Procurement & vendor assessment",
  description:
    "Regulatory control mapping, operational resilience facts, CAIQ-lite answers, and contract documents — everything a regulated enterprise needs to complete a vendor assessment, plus a machine-readable endpoint for tooling.",
});

export default function Procurement() {
  const regulatory = regulatoryMapping();
  return (
    <>
      <Header />

      <section className="hero">
        <div className="mk" style={{ paddingTop: "1rem", paddingBottom: "1rem" }}>
          <span className="mk-eyebrow">Procurement &amp; vendor assessment</span>
          <h1 className="hero-h1" style={{ maxWidth: "22ch" }}>
            Your review doesn&apos;t start from a <span className="accent">blank page</span>.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "58ch" }}>
            Regulatory control mapping, operational resilience facts, CAIQ-lite answers,
            and every contract document — honest about what&apos;s shipped and what isn&apos;t.
            Everything below is self-serve: no call required to get an answer.
          </p>
          <div className="hero-cta">
            <Link href="/security" className="btn-fill">Read the security overview →</Link>
            <a href="/api/procurement" className="btn-line">Get it as JSON →</a>
          </div>
        </div>
      </section>

      {/* Regulatory control mapping */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Regulatory mapping</span>
          <h2 className="mk-h2">Which requirements Runback addresses and what evidence it produces.</h2>
          <p className="mk-lead" style={{ marginBottom: "1.4rem" }}>
            Runback supports your controls — it is not, by itself, a compliance certificate.
          </p>
          <div className="reg-chip-row">
            {Object.entries(
              regulatory.reduce<Record<string, number>>((acc, r) => {
                const family = r.framework.split(" · ")[0];
                acc[family] = (acc[family] ?? 0) + 1;
                return acc;
              }, {})
            ).map(([family, count]) => (
              <span key={family} className="reg-chip">{family} · {count}</span>
            ))}
          </div>
          <details className="mk-details" style={{ marginTop: "1.2rem" }}>
            <summary className="mk-details-summary">View the full mapping ({regulatory.length} controls) →</summary>
          <div className="table-scroll">
            <table className="ptab" style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={{ width: "16%" }}>Framework</th>
                  <th style={{ width: "28%" }}>Requirement</th>
                  <th style={{ width: "30%" }}>Runback control</th>
                  <th>Evidence produced</th>
                </tr>
              </thead>
              <tbody>
                {regulatory.map((r) => {
                  // Same family-color convention as /regulatory — a row for
                  // an EU AI Act clause and a row for an APRA clause should
                  // read as visually distinct families at a glance, not just
                  // by re-reading the text in the first column.
                  const color = r.framework.startsWith("EU AI Act") ? "var(--brand-2)"
                    : r.framework.startsWith("APRA") ? "var(--violet)"
                    : "var(--blue)";
                  return (
                  <tr key={r.framework} style={{ boxShadow: `inset 3px 0 0 0 ${color}` }}>
                    <td className="mono" style={{ fontSize: "0.77rem", color: "var(--text-muted)", verticalAlign: "top", paddingTop: "0.9rem", paddingLeft: "0.9rem" }}>{r.framework}</td>
                    <td style={{ fontSize: "0.83rem", color: "var(--text-secondary)", lineHeight: 1.5, verticalAlign: "top", paddingTop: "0.9rem" }}>{r.requirement}</td>
                    <td style={{ fontSize: "0.83rem", lineHeight: 1.5, verticalAlign: "top", paddingTop: "0.9rem" }}>{r.control}</td>
                    <td style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5, verticalAlign: "top", paddingTop: "0.9rem" }}>{r.evidence}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </details>
        </div>
      </section>

      {/* Documents */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Documents</span>
          <h2 className="mk-h2">For your legal and procurement file.</h2>
          <div className="cap-grid">
            <div className="cap">
              <div className="cap-k mono">Security overview</div>
              <p>Architecture and data-handling summary — shipped controls and honest roadmap. <Link href="/security" style={{ color: "var(--brand)" }}>Read it →</Link></p>
            </div>
            <div className="cap">
              <div className="cap-k mono">DPA · Terms · Privacy</div>
              <p>The <Link href="/dpa" style={{ color: "var(--brand)" }}>DPA</Link>, <Link href="/terms" style={{ color: "var(--brand)" }}>Terms</Link>, and <Link href="/privacy" style={{ color: "var(--brand)" }}>Privacy Policy</Link> for your legal team. Signed DPA on request.</p>
            </div>
            <div className="cap">
              <div className="cap-k mono">MSA &amp; order form</div>
              <p>Enterprise master services agreement with SLAs and governing terms. Request at <a href="mailto:legal@runback.dev" style={{ color: "var(--brand)" }}>legal@runback.dev</a>.</p>
            </div>
            <div className="cap">
              <div className="cap-k mono">CAIQ-lite</div>
              <p>Pre-filled answers to standard vendor assessment questions — below on this page.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CAIQ */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">CAIQ-lite</span>
          <h2 className="mk-h2">Vendor assessment answers, pre-filled.</h2>
          <p className="mk-lead" style={{ marginBottom: "0.4rem" }}>
            Self-hosted deployments clear most of these automatically — when nothing leaves your perimeter, most answers are &ldquo;you control it.&rdquo;
          </p>
          {/* Collapsed by default — 20 full paragraphs on the page at once was
              exactly the "wall of text" problem; a reviewer scanning for one
              answer (data residency, say) shouldn't have to read past 19
              others to find it. */}
          <div className="faq-accordion">
            {CAIQ.map((item) => (
              <details className="faq-item" key={item.q}>
                <summary>
                  <span className="mono faq-item-domain">{item.domain}</span>
                  {item.q}
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Self-serve automation */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Automate this</span>
          <h2 className="mk-h2">Feed it straight into your vendor-assessment tool.</h2>
          <p className="mk-lead" style={{ maxWidth: "62ch" }}>
            The same regulatory mapping and CAIQ answers above, structured — so a security tool or a
            script can pull them directly instead of someone re-typing this page into a spreadsheet.
          </p>
          <div className="docs-code-block">
            <div className="docs-code-lang mono">bash</div>
            <pre className="docs-code"><code>{`curl https://runback.dev/api/procurement | jq .caiq
curl https://runback.dev/api/procurement | jq .regulatory_mapping`}</code></pre>
          </div>
        </div>
      </section>

      <section className="mk-cta-band">
        <div className="mk">
          <h2>Need a human anyway? We&apos;ll join the review.</h2>
          <p>For the questions the page and the API don&apos;t answer, bring your security team — we bring the documents.</p>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <a href="/demo" className="btn-line">Book a security review →</a>
            <Link href="/security" className="btn-fill">Security page</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
