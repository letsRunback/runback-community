import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";
import { PRICING_HREF } from "@/lib/edition";

export const metadata = pageMetadata({
  path: "/terms",
  title: "Terms of Service",
  description:
    "The terms that govern use of Runback's website, managed cloud, and software — including the free Community edition and the licensed Enterprise features.",
});

const UPDATED = "19 July 2026";

export default function Terms() {
  return (
    <>
      <Header />
      <main className="mk">
        <article className="legal">
          <span className="mk-eyebrow">Legal</span>
          <h1>Terms of Service</h1>
          <div className="legal-meta">Last updated {UPDATED}</div>

          <nav className="legal-toc" aria-label="Sections">
            {[
              ["#licensing", "1. Licensing"],
              ["#acceptable-use", "3. Acceptable use"],
              ["#fees", "4. Fees"],
              ["#liability", "9. Liability"],
              ["#governing-law", "13. Governing law"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="legal-toc-chip">{label}</a>
            ))}
          </nav>

          <p>
            These Terms are between you and <strong>Runback Pty Ltd, an Australian
            company based in Melbourne, Victoria</strong> (&quot;Runback&quot;,
            &quot;we&quot;). They govern your use of the Runback website, the managed
            cloud service, and the Runback software. By using any of them you agree to
            these Terms. If you&apos;re agreeing on behalf of an organisation, you
            represent that you can bind it. An executed order form or master services
            agreement (MSA), where one exists, takes precedence over these Terms.
          </p>

          <h2 id="licensing">1. The software &amp; licensing</h2>
          <p>
            Runback is proprietary software with a free Community edition. The
            Community edition is licensed under the Runback Community License and is
            free to install and self-host. Its source is published and you may read,
            modify and redistribute it under that licence; it is source-available,
            not open source, because the licence does not permit offering Runback to
            third parties as a hosted or managed service. Enterprise features (for
            example multi-tenant controls, the fleet dashboard, SSO, and alerting)
            require a valid <span className="mono">RUNBACK_LICENSE</span> to run in
            production under the Runback Commercial License. The split between
            editions is defined in <span className="mono">LICENSING.md</span>.
          </p>

          <h2>2. Accounts</h2>
          <p>
            You&apos;re responsible for activity under your account and for keeping
            access secure. Notify us promptly of any unauthorised use. You must be
            able to form a binding contract and must not be barred from using the
            service under applicable law.
          </p>

          <h2 id="acceptable-use">3. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Break the law or infringe others&apos; rights using the service.</li>
            <li>Probe, scan, or breach security except under our{" "}
              <Link href="/security">responsible-disclosure</Link> terms.</li>
            <li>Disrupt the service, including denial-of-service or abusive load.</li>
            <li>Resell or provide the managed service to third parties without our agreement.</li>
            <li>Circumvent the enterprise license gating.</li>
          </ul>
          <p>
            <strong>Consequences of AUP breach.</strong> Where Runback reasonably
            believes an AUP violation is active or ongoing (including active
            denial-of-service, unlawful use, or active circumvention of licence controls),
            we may <strong>suspend access immediately and without prior notice</strong> to
            protect the service and other users. We will notify you promptly after
            suspension. Where a violation has occurred but is not ongoing, we will give
            written notice and a reasonable opportunity to cure before suspension. We may
            terminate for AUP breach that is incapable of cure or is not cured within 7
            days of written notice, notwithstanding the 30-day cure period in §11.
          </p>

          <h2 id="fees">4. Fees</h2>
          <p>
            The Community edition is free. Paid plans (e.g. Pro at the price shown on
            our <Link href={PRICING_HREF}>pricing page</Link>, and Enterprise) are billed
            as described at sign-up or in your order form. Fees are exclusive of taxes
            unless stated. Unless your order says otherwise, paid subscriptions renew
            for successive terms and may be cancelled before the next renewal. We will
            give at least <strong>30 days&apos; advance notice</strong> before
            increasing prices on an active subscription; price changes do not apply to
            the current term.
          </p>

          <h2>5. Your data</h2>
          <p>
            You own your data. For the managed cloud, our handling of personal data is
            described in the <Link href="/privacy">Privacy Policy</Link> and{" "}
            <Link href="/dpa">DPA</Link>. When you self-host, your data stays in your
            infrastructure and we don&apos;t receive it. You&apos;re responsible for
            configuring redaction and for the lawfulness of the data your agents
            process.
          </p>

          <h2>6. Service availability</h2>
          <p>
            We aim for high availability of the managed cloud and publish support
            commitments on our <Link href="/support">support page</Link>. Enterprise
            SLAs, where offered, are set out in the order form or MSA. We will give at
            least <strong>30 days&apos; prior notice</strong> for material feature
            changes and at least <strong>90 days&apos; prior notice</strong> for
            discontinuation of the managed service, in each case by email to the account
            holder or a prominent notice in the service.
          </p>

          <h2>7. Intellectual property</h2>
          <p>
            Runback and its marks are owned by us. Except for the rights expressly
            granted (including the licenses for each edition), we reserve all rights. Feedback
            you provide may be used without obligation.
          </p>

          <h2>8. Warranties &amp; disclaimers</h2>
          <p>
            Except as expressly stated, the service and software are provided
            &quot;as is&quot; without warranties of any kind to the maximum extent
            permitted by law. We don&apos;t warrant that the service will be
            uninterrupted or error-free. Nothing here excludes warranties that
            cannot be excluded by law.
          </p>

          <h2 id="liability">9. Limitation of liability</h2>
          <p>
            Nothing in these Terms limits or excludes either party&apos;s liability
            for: (a) death or personal injury caused by that party&apos;s negligence;
            (b) fraud or fraudulent misrepresentation; or (c) any other liability that
            cannot be limited or excluded under applicable law.
          </p>
          <p>
            Subject to the above, and to the maximum extent permitted by law, neither
            party is liable for indirect, incidental, special, or consequential damages
            (including loss of profit, revenue, data, or business opportunity), and our
            aggregate liability is limited to the fees you paid for the service in the
            twelve months before the claim.
          </p>

          <h2>10. Indemnity</h2>
          <p>
            You agree to indemnify us against claims arising from your unlawful use of
            the service or breach of these Terms, to the extent permitted by law.
          </p>

          <h2>11. Term &amp; termination</h2>
          <p>
            Either party may terminate for material breach not cured within 30 days of
            written notice. On termination, your right to use the managed service
            ends; provisions that by nature survive (e.g. IP, liability, confidentiality)
            continue.
          </p>

          <h2>12. Change of control</h2>
          <p>
            If Runback undergoes a merger, acquisition, or sale of all or substantially
            all of its assets, we will give account holders reasonable prior notice by
            email or prominent service notice. The acquirer will be required to honour
            these Terms (including the DPA, where applicable) or provide account
            holders with at least 30 days&apos; notice and the opportunity to export or
            delete their data before any materially different terms take effect.
          </p>

          <h2 id="governing-law">13. Governing law</h2>
          <p>
            These Terms are governed by the laws of the State of Victoria, Australia,
            and disputes are subject to the exclusive jurisdiction of the courts of
            Victoria, Australia — except where your order form or MSA
            specifies otherwise, in which case that governs.
          </p>

          <h2>14. Dispute escalation</h2>
          <p>
            Before either party initiates formal legal proceedings (other than for
            urgent injunctive or emergency relief), the parties agree to attempt
            good-faith resolution by escalating the dispute to senior representatives
            of each party for a period of <strong>30 days</strong> following written
            notice from the complaining party. If the dispute is not resolved within
            that period, either party may pursue its legal remedies.
          </p>

          <h2>15. Force majeure</h2>
          <p>
            Neither party is liable for delay or failure in performance resulting from
            causes beyond that party&apos;s reasonable control, including acts of God,
            natural disaster, war, terrorism, pandemic, government action, internet
            infrastructure failure, or third-party service provider outages outside the
            party&apos;s reasonable control (&quot;Force Majeure Event&quot;). The
            affected party must notify the other promptly and use reasonable efforts to
            mitigate. If a Force Majeure Event continues for more than 60 consecutive
            days, either party may terminate affected services on written notice without
            penalty.
          </p>

          <h2>16. Changes</h2>
          <p>
            We may update these Terms and will post the new effective date here.
            Continued use after changes means you accept them.
          </p>

          <h2>17. Contact</h2>
          <p>
            Questions about these Terms: <a href="mailto:legal@runback.dev">legal@runback.dev</a>.
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
