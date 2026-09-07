import EditionLink from "@/components/EditionLink";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";
import {
  publicFrameworkDef,
  PUBLIC_REGULATORY_FRAMEWORK_IDS,
  type FrameworkId,
} from "@/lib/regulatoryFrameworks";

/**
 * One page per framework, built from the exact static clause map
 * (lib/regulatory.ts) the in-app Regulatory tab evaluates against an org's
 * real data — not a separate marketing summary of it. Deliberately has no
 * per-clause compliance verdict, unlike /eu-ai-act's hand-assessed
 * supplied/partial/yours column: that page was individually researched
 * against the Article 12 text, and doing the same for six more frameworks'
 * exact current wording is future work, not something to fake here. What's
 * true without that research is the capability mapping itself, so that's
 * what this page states.
 */

const EVIDENCE_LABEL: Record<string, string> = {
  policy_block: "A policy rule evaluated on a real tool call",
  ledger: "An entry in the hash-chained, append-only ledger",
  audit_log: "A captured run in the audit trace",
  report: "Aggregated from real run data into a compliance report",
  redaction: "A run where PII was redacted before capture",
  retention: "Your configured data-retention window",
  sso: "Whether SSO (OIDC) + RBAC is enabled for your org",
};

const FRAMEWORK_CONTEXT: Record<
  Exclude<FrameworkId, "eu_ai_act">,
  { blurb: string; limits: string[] }
> = {
  iso_42001: {
    blurb:
      "ISO/IEC 42001:2023 is the first international management-system standard for AI — the AI-governance equivalent of ISO 27001, and certifiable by an accredited body. It asks for documented risk management, monitoring, and continual improvement of an AI management system, not a specific logging format.",
    limits: [
      "ISO 42001 certification is an organisational audit, not a software feature. Runback supplies evidence for the clauses below; it does not make an organisation certified.",
      "Runback itself does not hold ISO 42001 certification. The security page states exactly what is and isn't certified today.",
    ],
  },
  nist_ai_rmf: {
    blurb:
      "The NIST AI Risk Management Framework (AI RMF 1.0, published January 2023) is a voluntary U.S. framework organised around four functions — Govern, Map, Measure, Manage. It has no certification body and no legal force on its own; it's widely used as a common vocabulary for AI risk programs and referenced by U.S. federal procurement guidance.",
    limits: [
      "There is nothing to certify against — NIST AI RMF is a framework to structure a risk program around, not a pass/fail standard.",
      "The subcategories below are a representative slice (one per function), not the full RMF, which runs to dozens of subcategories.",
    ],
  },
  apra_cps230: {
    blurb:
      "APRA CPS 230 (Operational Risk Management) took effect 1 July 2025 for APRA-regulated entities — Australian banks, insurers, and superannuation trustees. It is technology-agnostic: it never names AI specifically, but its obligations on incident management, business continuity, and third-party/service-provider risk apply wherever an AI agent sits inside a material business process.",
    limits: [
      "Exact paragraph-level numbering below is a section-level citation, not independently re-verified against the current CPS 230 PDF for this page. Confirm the precise paragraph reference before citing this mapping in a regulator-facing document.",
      "CPS 230 governs the operational-risk program as a whole. Runback's ledger and policy engine are evidence inputs to that program, not the program itself.",
    ],
  },
  gdpr: {
    blurb:
      "The EU General Data Protection Regulation (2016/679) governs personal data, not AI systems specifically — it applies to Runback's own customers whenever an agent's inputs or outputs contain personal data, which is most agentic workloads in practice. The mapping below covers the articles a run-capture and audit product is actually positioned to help with: minimisation, storage limitation, records of processing, and security of processing.",
    limits: [
      "GDPR has dozens of articles beyond the four mapped below (lawful basis, DSAR handling, cross-border transfer mechanisms, breach notification timing). Those are organisational and legal obligations Runback does not touch.",
      "Redaction reduces what personal data reaches Runback's storage; it does not by itself establish a lawful basis for processing it in the first place.",
    ],
  },
  iso_27001: {
    blurb:
      "ISO/IEC 27001:2022 is the general information-security management-system standard — distinct from ISO 42001's AI-specific scope above. The mapping below cites Annex A controls that Runback's own SSO, access control, and logging directly produce evidence for.",
    limits: [
      "ISO 27001 covers an organisation's entire information security management system. Runback contributes evidence to a handful of Annex A controls; it is not a substitute for the other ~90.",
      "Runback itself does not hold ISO 27001 certification today. The security page states exactly what is and isn't certified.",
    ],
  },
  apra_cps234: {
    blurb:
      "APRA CPS 234 (Information Security) has applied to APRA-regulated entities since 1 July 2019 — older and narrower in scope than CPS 230 above: CPS 234 is specifically information security, where CPS 230 is operational risk and business continuity more broadly.",
    limits: [
      "As with CPS 230, the citations below are section-level, not independently re-verified paragraph numbering against the current CPS 234 PDF.",
      "CPS 234 requires testing and assurance of security controls at a program level. Runback's golden-test suite and policy engine are two inputs to that, not the whole program.",
    ],
  },
};

export function generateStaticParams() {
  return PUBLIC_REGULATORY_FRAMEWORK_IDS.map((framework) => ({ framework }));
}

function isFrameworkId(v: string): v is FrameworkId {
  return v === "eu_ai_act" || (PUBLIC_REGULATORY_FRAMEWORK_IDS as string[]).includes(v);
}

export async function generateMetadata({ params }: { params: Promise<{ framework: string }> }) {
  const { framework: id } = await params;
  if (!isFrameworkId(id) || id === "eu_ai_act") {
    return pageMetadata({ path: `/regulatory/${id}`, title: "Regulatory — Runback" });
  }
  const def = publicFrameworkDef(id);
  return pageMetadata({
    path: `/regulatory/${id}`,
    title: `${def?.name ?? id} — what Runback maps to it, and how to verify`,
    description: `A clause-by-clause map from ${def?.name ?? id} to the Runback capability and evidence type behind each — the same static definition the in-app Regulatory tab evaluates against your real data.`,
  });
}

export default async function RegulatoryFrameworkPage({ params }: { params: Promise<{ framework: string }> }) {
  const { framework: id } = await params;
  if (id === "eu_ai_act") redirect("/eu-ai-act");
  if (!isFrameworkId(id)) notFound();

  const def = publicFrameworkDef(id);
  if (!def) notFound();
  const context = FRAMEWORK_CONTEXT[id as Exclude<FrameworkId, "eu_ai_act">];

  return (
    <>
      <Header />
      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Regulatory</span>
          <h1 className="hero-h1" style={{ maxWidth: "24ch" }}>
            {def.name} <span className="accent">({def.version})</span>
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>{context.blurb}</p>
          <p className="mk-lead" style={{ maxWidth: "62ch", fontSize: "0.88rem" }}>
            Below is the same static clause map the in-app{" "}
            <EditionLink href="/app/regulatory" className="mk-link">Regulatory tab</EditionLink> evaluates against your
            org&apos;s real data on every load — not a separate summary written for this page. There is no
            compliance verdict here, since that depends on your own data; sign in to see your org&apos;s
            live status per clause.
          </p>
        </div>
      </section>

      <main>
        <section className="mk-section">
          <div className="mk">
          <p className="table-scroll-hint mono">Swipe to see all columns →</p>
          <div className="table-scroll">
            <table className="ptab ptab-prose">
              <thead>
                <tr>
                  <th>Clause</th>
                  <th>Requirement</th>
                  <th>Runback capability</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {def.controls.map((c) => (
                  <tr key={c.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{c.clause}</td>
                    <td>{c.requirement}</td>
                    <td>{c.runback_capability}</td>
                    <td>
                      {EVIDENCE_LABEL[c.evidence_type] ?? c.evidence_type}
                      {c.evidence_link && (
                        <>
                          <br />
                          <Link href={c.evidence_link} className="mk-link" style={{ fontSize: "0.82rem" }}>
                            See it in the dashboard →
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </section>

        <section className="mk-section">
          <div className="mk">
          <span className="mk-eyebrow">Honest limits</span>
          <h2 className="mk-h2">What this page does not claim.</h2>
          <ul className="docs-list" style={{ maxWidth: "62ch" }}>
            {context.limits.map((l) => (
              <li key={l.slice(0, 24)}>{l}</li>
            ))}
            <li>
              This is a capability map, not a conformity determination. Whether your deployment
              satisfies {def.name} is a determination for your own assessor — what&apos;s listed above
              is the evidence that argument draws on.
            </li>
          </ul>
          </div>
        </section>

        <section className="mk-cta-band">
          <div className="mk">
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <EditionLink href="/app/regulatory" className="btn-line">See your org&apos;s status →</EditionLink>
            <Link href="/verify" className="btn-line">Verify a record now →</Link>
          </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
