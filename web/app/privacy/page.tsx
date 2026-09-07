import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy Policy",
  description:
    "How Runback collects, uses, and protects personal data — and why, when you self-host, your agent traces never reach us at all.",
});

const UPDATED = "19 July 2026";

export default function Privacy() {
  return (
    <>
      <Header />
      <main className="mk">
        <article className="legal">
          <span className="mk-eyebrow">Legal</span>
          <h1>Privacy Policy</h1>
          <div className="legal-meta">Last updated {UPDATED}</div>

          <nav className="legal-toc" aria-label="Sections">
            {[
              ["#data-we-collect", "1. Data we collect"],
              ["#how-we-use-data", "2. How we use it"],
              ["#retention", "6. Retention"],
              ["#your-rights", "8. Your rights"],
              ["#cookies", "10. Cookies"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="legal-toc-chip">{label}</a>
            ))}
          </nav>

          <p>
            This policy explains what personal data <strong>Runback Pty Ltd, an
            Australian company based in Melbourne, Victoria</strong> (&quot;Runback&quot;, &quot;we&quot;), acting as data
            controller, collects, how we use it, and the choices you have. It covers
            our website and our managed cloud service. It does not change the rights
            you have under applicable law. Data-protection queries:{" "}
            <a href="mailto:privacy@runback.dev">privacy@runback.dev</a>.
          </p>

          <div className="legal-note">
            <strong>Self-host changes everything below.</strong> When you run Runback
            in your own infrastructure, your agent traces are written to a database
            you control and <strong>never reach us</strong>. For self-hosted
            deployments we do not receive, store, or process your agents&apos; data,
            and we act only as a software provider — not a data processor.
          </div>

          <h2 id="data-we-collect">1. Data we collect</h2>
          <h3>Account &amp; contact data</h3>
          <p>
            When you sign in or contact us we process your work email, name, and the
            organisation you belong to. Sign-in is passwordless — we email a one-time
            link and store only a hashed token, never a password.
          </p>
          <h3>Usage &amp; diagnostic data</h3>
          <p>
            For our website and managed cloud we process standard technical data —
            IP address, browser, pages viewed, and product events — to operate,
            secure, and improve the service.
          </p>
          <h3>Agent trace data (managed cloud only)</h3>
          <p>
            If you use our managed cloud, the traces your instrumented agents send us
            are stored to power observe, replay, evals, and audit. Sensitive values
            (secrets, keys, emails, card numbers, SSNs) are designed to be{" "}
            <Link href="/security">redacted inside your own process</Link> before a
            trace ever leaves it. You control what your instrumentation sends.
          </p>

          <h2 id="how-we-use-data">2. How we use data</h2>
          <ul>
            <li>To provide, secure, and operate the service and your account.</li>
            <li>To respond to your requests and provide support.</li>
            <li>To detect, prevent, and investigate abuse or security incidents.</li>
            <li>To meet legal, accounting, and regulatory obligations.</li>
          </ul>
          <p>
            We do <strong>not</strong> sell personal data, and we do not use your
            agent trace data to train models.
          </p>

          <h2>3. Legal bases (GDPR)</h2>
          <p>
            Where the GDPR applies, we rely on: performance of a contract (to provide
            the service), legitimate interests (to secure and improve it), consent
            (where required, e.g. certain cookies), and legal obligation.
          </p>

          <h2>4. Sharing &amp; sub-processors</h2>
          <p>
            We share data only with vendors that help us run the service (hosting,
            email delivery, payments, analytics), each under contract and only as
            needed. Our current sub-processor list and our Data Processing Agreement
            are available in the{" "}
            <Link href="/dpa">DPA</Link> and on request via{" "}
            <a href="mailto:privacy@runback.dev">privacy@runback.dev</a>.
          </p>

          <h2>5. International transfers</h2>
          <p>
            Where data crosses borders, we use appropriate safeguards such as
            Standard Contractual Clauses. The managed cloud currently resides in
            the United States (US); self-host customers keep data in their own region by definition.
            EU or Australian residency requires the Enterprise self-hosted tier.
          </p>

          <h2 id="retention">6. Retention</h2>
          <p>
            We retain personal data only as long as needed for the purpose collected or
            as required by law:
          </p>
          <ul>
            <li><strong>Account &amp; contact data</strong> — retained while your account is active, plus 30 days after account closure (to allow for reactivation), then deleted unless a longer period is required by applicable law.</li>
            <li><strong>Agent trace data</strong> — retained in two phases. Raw event payloads are deleted at the end of your plan&apos;s retention window (7 days on Community, 30 days on Starter, 60 days on Growth/Scale, 90 days on Pro, configurable on Enterprise). Run-level summary metadata (name, status, token counts, timestamps) is retained for up to twice the plan window before permanent deletion. You can delete any run at any time; deletion queues removal from active systems within 30 days.</li>
            <li><strong>Usage &amp; diagnostic data</strong> — retained for up to 24 months from collection.</li>
            <li><strong>Billing records</strong> — retained for 7 years to meet accounting and tax obligations.</li>
          </ul>
          <p>
            Self-host customers control retention entirely — data never reaches us and
            this section does not apply.
          </p>

          <h2>7. Security</h2>
          <p>
            We protect data with measures including in-process redaction, hashed
            credentials, encrypted transport, role-based access, and tamper-evident
            audit records. See our <Link href="/security">security page</Link> for
            specifics and an honest view of what is and isn&apos;t yet in place.
          </p>

          <h2 id="your-rights">8. Your rights</h2>
          <p>
            Depending on where you live, you may have rights to access, correct,
            delete, port, or restrict processing of your personal data, and to object
            or withdraw consent. To exercise them, email{" "}
            <a href="mailto:privacy@runback.dev">privacy@runback.dev</a>. We will
            respond within <strong>one calendar month</strong> of receiving your
            request (extendable by two further months for complex or numerous requests,
            with explanation). We may ask you to verify your identity before acting on
            a request.
          </p>
          <p>
            <strong>Supervisory authority complaints.</strong> You may also lodge a
            complaint with your local data-protection authority. For users in the
            United Kingdom, the relevant authority is the{" "}
            <strong>Information Commissioner&apos;s Office (ICO)</strong> —
            <a href="https://ico.org.uk"> ico.org.uk</a>. For users in the EEA, the
            relevant authority is the supervisory authority of your country of
            residence or establishment.
          </p>

          <h2>9. Automated decision-making</h2>
          <p>
            Runback&apos;s policy enforcement engine may automatically block or flag
            agent actions based on configured policy rules. These automated checks
            operate on your agents&apos; outputs — they do not produce legal or
            similarly significant effects on individuals in the sense of GDPR Art.22(1).
            You, as the controller, design the policies and remain responsible for any
            decisions that affect individuals. Where your use of Runback does give rise
            to Art.22(1) automated decisions, you are responsible for meeting the
            applicable obligations (providing human review, explaining the logic, and
            enabling individuals to contest outcomes). Contact{" "}
            <a href="mailto:privacy@runback.dev">privacy@runback.dev</a> if you need
            assistance assessing your Art.22 obligations.
          </p>

          <h2 id="cookies">10. Cookies</h2>
          <p>
            We use <strong>strictly necessary cookies only</strong> — a single
            session cookie (<span className="mono">__Host-rb_session</span>) that
            authenticates your signed-in session. No analytics, tracking, or
            advertising cookies are deployed on this site. Because we use only
            strictly necessary cookies, no consent banner is required and no
            non-essential cookies can be configured through your browser.
          </p>

          <h2>11. Change of control</h2>
          <p>
            If Runback is involved in a merger, acquisition, or sale of assets, your
            personal data may be transferred as part of that transaction. We will
            notify account holders by email or a prominent notice on the service before
            personal data is transferred or becomes subject to a different privacy
            policy. You may delete your account and data before any such transfer takes
            effect.
          </p>

          <h2>12. Changes to this policy</h2>
          <p>
            We&apos;ll update this policy as the product evolves and post the new
            effective date here. Material changes will be communicated to account
            holders.
          </p>

          <h2>13. Contact &amp; DPO</h2>
          <p>
            Privacy questions: <a href="mailto:privacy@runback.dev">privacy@runback.dev</a>.
            Security reports: <a href="mailto:security@runback.dev">security@runback.dev</a>.
          </p>
          <p>
            Runback has assessed its obligations under GDPR Art.37 and does not
            currently meet the criteria requiring mandatory appointment of a Data
            Protection Officer. Privacy and data-protection matters are handled
            directly by our team at{" "}
            <a href="mailto:privacy@runback.dev">privacy@runback.dev</a>. If our
            processing activities change in a way that requires DPO appointment, we
            will update this policy.
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
