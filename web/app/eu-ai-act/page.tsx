import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/eu-ai-act",
  title: "EU AI Act Article 12 — automatic logging, and how to verify it",
  description:
    "Article 12 took effect on 2 August 2026. What it requires of high-risk AI system logs, which parts Runback supplies, and the exact commands to verify each claim yourself without an account.",
});

/**
 * Article 12 conformance.
 *
 * Written as a mapping, not a brochure. Every row names the mechanism and the
 * command that checks it, because a compliance page that cannot be verified is
 * the thing this product exists to argue against. Rows where Runback supplies
 * nothing say so — an obligation we do not help with is still the reader's
 * obligation, and pretending otherwise is how a vendor page becomes a liability
 * for the person who relied on it.
 */
const REQUIREMENTS: {
  clause: string;
  requirement: string;
  status: "supplied" | "partial" | "yours";
  mechanism: string;
  verify?: string;
}[] = [
  {
    clause: "Art. 12(1)",
    requirement:
      "High-risk systems shall technically allow for the automatic recording of events (logs) over the lifetime of the system.",
    status: "supplied",
    mechanism:
      "The SDK records every model call, tool call, and agent step from inside your process — automatic, not manual documentation. Capture is a single import, or OpenTelemetry if you already emit spans.",
    verify: "npx @runback/verify <your-export>.json",
  },
  {
    clause: "Art. 12(2)(a)",
    requirement:
      "Logs shall enable identification of situations that may result in the system presenting a risk, or a substantial modification.",
    status: "supplied",
    mechanism:
      "Policy rules evaluate on every gated tool call and record the decision — allowed or blocked — as part of the run. A blocked action carries the rule that blocked it, so a risk situation is a queryable event rather than something inferred from prose.",
    verify: "GET /api/compliance/report?from=…&to=…",
  },
  {
    clause: "Art. 12(2)(b)",
    requirement: "Logs shall facilitate post-market monitoring (Art. 72).",
    status: "supplied",
    mechanism:
      "Runs aggregate into a period report — volumes, error rates, policy evaluations and blocks, redaction counts — computed from the database, not sampled, so the report's numbers are the data's numbers.",
    verify: "GET /api/compliance/report",
  },
  {
    clause: "Art. 12(2)(c)",
    requirement: "Logs shall enable monitoring of operation by deployers (Art. 26(5)).",
    status: "supplied",
    mechanism:
      "Per-agent coverage reconciles the agents you declared against the ones actually reporting: declared but never instrumented, reporting then gone silent, or running while absent from your register.",
    verify: "GET /api/app/coverage",
  },
  {
    clause: "Art. 12(3)",
    requirement:
      "Logs shall include the period of each use, the reference database checked against, the input data, and the identity of the persons verifying results.",
    status: "partial",
    mechanism:
      "Start/end timestamps, exact inputs, retrieved context, and tool results are captured per run. Human verification is captured where an approval gate is used. If your process has a reviewer step outside Runback, that identity isn't in our record — record it yourself.",
  },
  {
    clause: "Art. 19 / 26(6)",
    requirement:
      "Logs shall be kept for a period appropriate to the intended purpose, at least six months.",
    status: "supplied",
    mechanism:
      "Retention is configured per plan and enforced by a scheduled sweep. Legal hold suspends deletion for runs under a preservation obligation, and if the holds table cannot be read the sweep is skipped rather than proceeding — the failure mode favours keeping data.",
  },
  {
    clause: "Art. 12 — implied",
    requirement:
      "Logs must be reliable as evidence. The Act does not use the word 'tamper-proof', but a record that can be edited without anyone noticing is not evidence of anything.",
    status: "supplied",
    mechanism:
      "Every run is hash-chained and signed; each org's runs are sealed into an append-only ledger with signed checkpoints. Checkpoints are additionally time-stamped by independent RFC 3161 authorities and published to a public append-only log — so the record is not merely signed by us, it is anchored outside our control.",
    verify: "openssl ts -reply -in <checkpoint>.tsr -token_in -text",
  },
  {
    clause: "Art. 9, 11, 17",
    requirement:
      "Risk management system, technical documentation, quality management system.",
    status: "yours",
    mechanism:
      "Runback supplies evidence that feeds these; it does not produce them. A conformity assessment is an organisational process. Any vendor claiming to deliver Article 9 or 17 compliance as a product feature is overselling.",
  },
];

const LABEL = {
  supplied: { text: "Supplied", color: "var(--emerald)" },
  partial: { text: "Partial", color: "var(--amber, #d99a3d)" },
  yours: { text: "Your obligation", color: "var(--text-tertiary)" },
} as const;

// One glyph per status — a colored dot alone repeats the /security mistake
// this session already corrected once (a colored dot with no shape carries
// no information at a glance beyond "which color is my favorite").
function StatusGlyph({ status }: { status: keyof typeof LABEL }) {
  const color = LABEL[status].color;
  if (status === "supplied") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "partial") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="2" />
        <path d="M7 1.5A5.5 5.5 0 0 1 7 12.5" fill={color} stroke="none" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="2" />
    </svg>
  );
}

const SUPPLIED_COUNT = REQUIREMENTS.filter((r) => r.status === "supplied").length;
const PARTIAL_COUNT = REQUIREMENTS.filter((r) => r.status === "partial").length;
const YOURS_COUNT = REQUIREMENTS.filter((r) => r.status === "yours").length;

export default function EuAiAct() {
  return (
    <>
      <Header />

      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Regulatory</span>
          <h1 className="hero-h1" style={{ maxWidth: "24ch" }}>
            Article 12, <span className="accent">clause by clause</span>.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>
            Article 12 has applied to high-risk AI systems since <strong>2 August 2026</strong> —
            automatic event logging, retained at least six months, sufficient to trace what the
            system did and why. Penalties reach €15,000,000 or 3% of worldwide annual turnover.
          </p>
          <div className="hero-cta">
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <Link href="/verify" className="btn-line">Verify a record now →</Link>
          </div>
        </div>
      </section>

      {/* Status summary — the shape a reviewer scans for first: how much of
          this article is actually covered, before reading a single clause. */}
      <section className="mk-section">
        <div className="mk">
          <div className="reg-status-row">
            <div className="reg-status-item">
              <StatusGlyph status="supplied" />
              <span className="reg-status-count">{SUPPLIED_COUNT}</span>
              <span className="reg-status-label">supplied</span>
            </div>
            <div className="reg-status-item">
              <StatusGlyph status="partial" />
              <span className="reg-status-count">{PARTIAL_COUNT}</span>
              <span className="reg-status-label">partial</span>
            </div>
            <div className="reg-status-item">
              <StatusGlyph status="yours" />
              <span className="reg-status-count">{YOURS_COUNT}</span>
              <span className="reg-status-label">your obligation</span>
            </div>
          </div>

          <div className="reg-clause-grid">
            {REQUIREMENTS.map((r) => (
              <div className="reg-clause-card" key={r.clause + r.requirement.slice(0, 20)} style={{ borderTopColor: LABEL[r.status].color }}>
                <div className="reg-clause-hd">
                  <span className="mono reg-clause-id">{r.clause}</span>
                  <span className="reg-clause-status" style={{ color: LABEL[r.status].color }}>
                    <StatusGlyph status={r.status} />
                    {LABEL[r.status].text}
                  </span>
                </div>
                <p className="reg-clause-req">{r.requirement}</p>
                <p className="reg-clause-mech">{r.mechanism}</p>
                {r.verify && (
                  <code className="mono reg-clause-verify">{r.verify}</code>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Verify it yourself</span>
          <h2 className="mk-h2">No account. No Runback software beyond one npx command.</h2>
          <p className="mk-lead" style={{ maxWidth: "62ch" }}>
            A compliance claim you cannot check is a marketing claim. Every statement above
            resolves to something you can run:
          </p>
          <div className="docs-code-block">
            <div className="docs-code-lang mono">bash</div>
            <pre className="docs-code"><code>{`# 1. Verify a record's integrity and origin — no account required
npx @runback/verify audit-export.json
#    exit 0 = intact AND signed by our published key
#    exit 2 = intact, but origin unproven
#    exit 1 = a check failed

# 2. Check our published signing key out of band
curl https://runback.dev/.well-known/runback-audit-key.pem

# 3. Confirm a checkpoint was time-stamped by an authority we do not control
openssl ts -reply -in runback-checkpoint-4-freetsa.org.tsr -token_in -text

# 4. Read the public transparency log and archive it
curl https://runback.dev/api/transparency`}</code></pre>
          </div>
          <p className="mk-lead" style={{ maxWidth: "62ch", fontSize: "0.92rem" }}>
            Steps 2–4 use no Runback software at all. That is deliberate: an auditor should not
            have to run our verifier to check our tamper-evidence.
          </p>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <details className="mk-details">
            <summary className="mk-details-summary">Honest limits — what this page does not claim →</summary>
            <ul className="docs-list" style={{ maxWidth: "62ch" }}>
              <li>
                <strong>No regulator certifies a file format.</strong> Whether your deployment
                satisfies Article 12 is a determination for your assessor. What we supply is the
                evidence that argument needs.
              </li>
              <li>
                <strong>The harmonised standards are not final.</strong>{" "}
                ISO/IEC 24970 (AI system logging) is at FDIS and prEN 18229-1 is at DIS ballot.
                Nobody can claim conformance to an unpublished standard, including us. We track
                both and will publish a clause map when they land.
              </li>
              <li>
                <strong>Runback is not certified.</strong> No SOC 2 report, no ISO 42001, no
                third-party penetration test yet. The{" "}
                <Link href="/security" className="mk-link">security page</Link> states exactly what
                is shipped and what is not.
              </li>
              <li>
                <strong>Article 12 is one clause.</strong> Articles 9, 11 and 17 are organisational
                processes. Evidence helps; it is not the same thing.
              </li>
            </ul>
          </details>
        </div>
      </section>

      <section className="mk-cta-band">
        <div className="mk">
          <h2>Read the record format, or verify one now.</h2>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <Link href="/spec" className="btn-line">Read the record format →</Link>
            <Link href="/verify" className="btn-line">Verify a record now →</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
