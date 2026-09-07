import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";
import { COMPETITORS } from "@/lib/competitors";

export const metadata = pageMetadata({
  path: "/vs",
  title: "vs. LangSmith, Langfuse, Arize, Braintrust",
  description:
    "The others observe. Runback re-executes and proves. A direct capability comparison of Runback against every major AI agent observability platform.",
});

const CAPABILITIES: [string, string, string][] = [
  ["See what the agent did", "y", "y"],
  ["Reproduce a real incident bit-for-bit", "y", "n"],
  ["Continue a counterfactual past the first divergence", "y", "n"],
  ["Bisect the model/prompt change that caused a regression", "y", "n"],
  ["Simulate a policy against history, then enforce it live", "y", "n"],
  ["Regression tests auto-mined from incidents", "y", "~"],
  ["Replay fidelity compounds with every captured run", "y", "n"],
  ["Tamper-evident, signed system of record", "y", "n"],
  ["Isolates concurrent agent calls correctly — no cross-request context bleed (AsyncLocalStorage)", "y", "n"],
  ["Ignores volatile noise (timestamps, request IDs) so replay match doesn't false-positive", "y", "n"],
  ["Hash tree resistant to substitution attacks, not just a flat hash chain (Merkle-rooted, domain-separated)", "y", "n"],
  ["Runs in your perimeter · self-hostable", "y", "~"],
];

function Glyph({ v }: { v: string }) {
  if (v === "y") return <span className="cmp-y">✓</span>;
  if (v === "~") return <span style={{ color: "var(--amber)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>partial</span>;
  return <span className="cmp-n">—</span>;
}

// Monogram initials for competitors — an honest stand-in visual anchor,
// since third-party logos can't be reused here without permission, but a
// bare bulleted link list ("no logos/visual anchor") is exactly what the
// site-wide audit flagged this page for.
const MONO_COLORS = ["var(--blue)", "var(--violet)", "var(--rose)", "var(--brand)", "var(--brand-2)", "var(--amber)"];

export default function Vs() {
  const runbackOnly = CAPABILITIES.filter(([, , them]) => them === "n").length;

  return (
    <>
      <Header />

      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Runback vs. the field</span>
          <h1 className="hero-h1" style={{ maxWidth: "24ch" }}>
            The others observe. <span className="accent">Runback re-executes and proves.</span>
          </h1>
          <p className="hero-lead" style={{ maxWidth: "64ch" }}>
            Every other tool in this space is read-only — it shows you a trace and stops. Runback
            re-runs a decision deterministically, seals a tamper-evident record, and gates the
            next change against policy.
          </p>
          <div className="hero-cta">
            <Link href="/runs" className="btn-fill">Open a live run →</Link>
            <Link href="/how-it-works" className="btn-line">See the MTTR proof →</Link>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <div className="reg-status-row">
            <div className="reg-status-item">
              <span className="cmp-y" style={{ fontSize: "1.4rem" }}>✓</span>
              <span className="reg-status-count">{CAPABILITIES.length}</span>
              <span className="reg-status-label">capabilities compared</span>
            </div>
            <div className="reg-status-item">
              <span className="cmp-y" style={{ fontSize: "1.4rem" }}>✓</span>
              <span className="reg-status-count">{runbackOnly}</span>
              <span className="reg-status-label">Runback-only, verified in public CI</span>
            </div>
          </div>

          <div className="table-scroll">
            <div className="cmp-table">
              <div className="cmp-row cmp-head">
                <div className="cmp-c">Capability</div>
                <div className="cmp-c us">Runback</div>
                <div className="cmp-c">
                  Observability tools
                  <span className="cmp-note">
                    {Object.values(COMPETITORS).map((c) => c.name).join(" · ")}
                  </span>
                </div>
              </div>
              {CAPABILITIES.map(([cap, us, them]) => (
                <div className="cmp-row" key={cap}>
                  <div className="cmp-c">{cap}</div>
                  <div className="cmp-c us"><Glyph v={us} /></div>
                  <div className="cmp-c"><Glyph v={them} /></div>
                </div>
              ))}
            </div>
          </div>

          <p className="empty" style={{ marginTop: "1.1rem", fontSize: "0.85rem" }}>
            Read-only observability is a crowded category. Re-execution and proof is a category of one — and every claim above runs green in{" "}
            <a href="https://github.com/letsRunback/runback-proofs/actions" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
              public CI ↗
            </a>.
          </p>
          <p className="empty" style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
            Not the same category as real-time guardrail/trust-and-safety filters (prompt injection, jailbreak, PII exfiltration) — those inspect a single call in isolation and are worth running alongside Runback, not instead of it. Runback&apos;s gate gets its verdict from simulating your policy against your own decision history first, then enforcing it live, and every block is a signed entry in the same ledger as everything else — provable after the fact, not just filtered in the moment.
          </p>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Head-to-head</span>
          <h2 className="mk-h2">Pick your incumbent.</h2>
          <div className="reg-grid">
            {Object.entries(COMPETITORS).map(([slug, c], i) => (
              <Link key={slug} href={`/vs/${slug}`} className="reg-card" style={{ borderTopColor: MONO_COLORS[i % MONO_COLORS.length] }}>
                <span
                  className="mono"
                  style={{
                    width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: "0.95rem", fontWeight: 700,
                    background: MONO_COLORS[i % MONO_COLORS.length], color: "var(--bg-base)",
                  }}
                >
                  {c.name[0]}
                </span>
                <span className="reg-card-name" style={{ marginTop: "0.6rem" }}>{c.name}</span>
                <span className="reg-card-note">{c.pitch}</span>
                <span className="reg-card-arrow" style={{ color: MONO_COLORS[i % MONO_COLORS.length] }}>Runback vs. {c.name} →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-cta-band">
        <div className="mk">
          <h2>See the difference in 4 minutes.</h2>
          <p>Open a real failing run — no signup required.</p>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <Link href="/runs" className="btn-fill">Open a live run →</Link>
            <Link href="/how-it-works" className="btn-line">See the MTTR proof</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
