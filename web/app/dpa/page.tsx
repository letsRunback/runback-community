import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/dpa",
  title: "Data Processing Agreement",
  description:
    "Runback's Data Processing Agreement for managed-cloud customers — roles, sub-processors, security measures, international transfers, and your instructions. Self-host customers don't need a DPA because we never receive your data.",
});

const UPDATED = "7 September 2026";

export default function Dpa() {
  return (
    <>
      <Header />
      <main className="mk">
        <article className="legal">
          <span className="mk-eyebrow">Legal</span>
          <h1>Data Processing Agreement</h1>
          <div className="legal-meta">Last updated {UPDATED}</div>

          <nav className="legal-toc" aria-label="Sections">
            {[
              ["#roles", "1. Roles"],
              ["#sub-processors", "4. Sub-processors"],
              ["#transfers", "5. International transfers"],
              ["#security-measures", "6. Security measures"],
              ["#breach", "7. Breach notice"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="legal-toc-chip">{label}</a>
            ))}
          </nav>

          <p>
            This DPA forms part of the agreement between the customer
            (&quot;Controller&quot;) and <strong>Runback Pty Ltd, an Australian company
            based in Melbourne, Victoria (&quot;Processor&quot;)</strong>, for the managed cloud service. It governs
            Runback&apos;s processing of personal data on the customer&apos;s behalf.
            A countersignable copy — which includes completed Annexes I, II, and III and
            constitutes the binding Art.28 GDPR processor agreement — is available from{" "}
            <a href="mailto:legal@runback.dev">legal@runback.dev</a>.
          </p>

          <div className="legal-note">
            <strong>Self-host doesn&apos;t need a DPA.</strong> If you run Runback in
            your own infrastructure, you remain the sole controller and processor of
            your data — we never receive it, so there is no processing for us to
            govern. This DPA applies only to the managed cloud. If your legal team
            requires a vendor agreement for software supply-chain due diligence
            regardless of data flow, contact{" "}
            <a href="mailto:legal@runback.dev">legal@runback.dev</a> for an
            appropriate addendum.
          </div>

          <h2 id="roles">1. Roles</h2>
          <p>
            For personal data contained in agent traces and account data processed via
            the managed cloud, the customer is the Controller and Runback is the
            Processor. Runback processes such data only on the customer&apos;s
            documented instructions, including those expressed through use of the
            service.
          </p>

          <h2>2. Subject matter &amp; duration</h2>
          <table>
            <tbody>
              <tr><th>Subject matter</th><td>Provision of the Runback managed cloud (observe, replay, evals, audit).</td></tr>
              <tr><th>Duration</th><td>For the term of the agreement, plus any limited deletion window.</td></tr>
              <tr><th>Nature &amp; purpose</th><td>Storing and processing agent trace and account data to deliver the service.</td></tr>
              <tr><th>Data subjects</th><td>The customer&apos;s users and any individuals whose data appears in traces (designed to be redacted in-process).</td></tr>
              <tr><th>Categories</th><td>Account identifiers; technical/usage data; trace content as configured by the customer.</td></tr>
            </tbody>
          </table>

          <h2>3. Processor obligations</h2>
          <ul>
            <li>Process only on documented instructions, including for transfers.</li>
            <li>Ensure personnel are bound by confidentiality.</li>
            <li>Implement appropriate technical and organisational measures (Section 6).</li>
            <li>Assist the Controller with data-subject requests and with security, breach, and impact-assessment obligations.</li>
            <li>Delete or return personal data at the end of the service, subject to legal retention.</li>
            <li>Make available all information necessary to demonstrate compliance with the obligations in Art.28 GDPR, and allow for and contribute to audits, including inspections, conducted by the Controller or another auditor mandated by the Controller, subject to reasonable prior notice and appropriate confidentiality obligations.</li>
          </ul>

          <h2 id="sub-processors">4. Sub-processors &amp; independent controllers</h2>
          <p>
            The Controller authorises Runback to engage the following sub-processors
            under written terms imposing equivalent data-protection obligations:
          </p>
          <table>
            <thead><tr><th>Sub-processor</th><th>Purpose</th><th>Location</th></tr></thead>
            <tbody>
              <tr><td><strong>Supabase Inc.</strong></td><td>Managed Postgres database and authentication infrastructure — stores agent trace records, account data, and audit logs for the managed cloud.</td><td>United States</td></tr>
              <tr><td><strong>Resend Inc.</strong></td><td>Transactional email delivery — sends magic-link sign-in emails and alert notifications. Receives recipient email address and message content only.</td><td>United States</td></tr>
              <tr><td><strong>Vercel Inc.</strong></td><td>Application hosting and edge delivery for the managed cloud — processes requests, and provides cookieless page analytics for the marketing site (aggregate views, referrer, country). Receives request data in transit; agent trace content is stored by Supabase, not Vercel.</td><td>United States</td></tr>
            </tbody>
          </table>
          <p>
            <strong>Independent controllers (not sub-processors):</strong>{" "}
            Lemon Squeezy LLC
            operates as Merchant of Record for paid subscriptions. As MoR, Lemon Squeezy
            acts as an independent data controller for payment and billing data — it is not
            a sub-processor of Runback and is not bound by this DPA. Lemon Squeezy&apos;s
            own privacy policy and terms govern its processing of your payment data.
          </p>
          <p>
            Runback will give the Controller{" "}
            <strong>at least 30 days&apos; advance written notice</strong> of any intended
            addition or replacement of sub-processors listed above, allowing the Controller
            reasonable time to object before the change takes effect. The countersignable
            DPA (available from{" "}
            <a href="mailto:legal@runback.dev">legal@runback.dev</a>) includes an Annex III
            with the current, dated sub-processor list.
          </p>

          <h2 id="transfers">5. International transfers</h2>
          <p>
            Where personal data is transferred from the EEA or UK to a third country,
            the parties rely on the Standard Contractual Clauses adopted by the European
            Commission (Implementing Decision 2021/914), Module 2 (Controller to
            Processor), which are incorporated by reference. For UK transfers, the
            parties additionally rely on the UK Addendum to those SCCs (issued by the
            ICO under S119A(1) of the UK Data Protection Act 2018). The completed
            Annexes I (description of processing and competent supervisory authority),
            II (technical and organisational security measures), and III (sub-processor
            list) are included in the countersignable DPA available from{" "}
            <a href="mailto:legal@runback.dev">legal@runback.dev</a>. No transfer
            occurs for self-hosted deployments.
          </p>

          <h2 id="security-measures">6. Security measures</h2>
          <p>
            Runback maintains measures appropriate to the risk, including: in-process
            redaction of secrets and PII before egress; encrypted transport; hashed
            credentials and API keys; role-based access control; tenant isolation;
            tamper-evident, hash-chained audit records; and rate limiting. The current,
            honest state of these controls is published on our{" "}
            <Link href="/security">security page</Link>.
          </p>

          <h2 id="breach">7. Personal-data breach</h2>
          <p>
            Runback will notify the Controller <strong>without undue delay and in any
            case within 48 hours</strong> of becoming aware of a personal-data breach
            affecting the Controller&apos;s data, and will provide information
            reasonably needed for the Controller&apos;s own notification duties under
            applicable law (including GDPR Art. 33 and APRA CPS 234).
          </p>

          <h2>8. Deletion &amp; return</h2>
          <p>
            On termination, Runback will delete or return the Controller&apos;s
            personal data <strong>within 30 days</strong>, except where retention is
            required by applicable law. The Controller can delete individual runs at
            any time through the service. Self-hosted deployments retain full control
            of their database and may execute deletion immediately.
          </p>

          <h2>9. Liability &amp; precedence</h2>
          <p>
            Liability under this DPA is subject to the limitations in the{" "}
            <Link href="/terms">Terms</Link> or MSA, except that the aggregate
            liability cap shall not limit either party&apos;s liability arising from a
            personal-data breach caused by that party&apos;s breach of this DPA or
            gross negligence or wilful misconduct in its data-protection obligations —
            such liability remains uncapped or subject to a separate higher sub-cap as
            agreed in the executed MSA. If there is a conflict on data-protection
            matters, this DPA controls.
          </p>

          <h2>10. Contact</h2>
          <p>
            Data-protection contact: <a href="mailto:privacy@runback.dev">privacy@runback.dev</a>.
            To execute a signed DPA: <a href="mailto:legal@runback.dev">legal@runback.dev</a>.
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
