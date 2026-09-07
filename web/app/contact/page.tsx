import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/contact",
  title: "Contact",
  description:
    "Talk to the Runback team — deployment, security reviews, or a question. We reply fast.",
});

export default function Contact() {
  return (
    <>
      <Header />
      <main className="mk" style={{ paddingTop: "3rem", paddingBottom: "3rem" }}>
        <span className="mk-eyebrow">Contact</span>
        <h1 style={{ fontSize: "clamp(2rem,4vw,2.8rem)", letterSpacing: "-0.04em", margin: "1rem 0 0.6rem" }}>
          Talk to us directly.
        </h1>
        <p className="mk-lead" style={{ marginBottom: "2.5rem" }}>
          You reach the engineers who build Runback — a real reply, usually the same day.
        </p>

        <div className="contact-grid">
          <Link className="contact-card" href="/demo">
            <div className="contact-k mono">Book a call</div>
            <h3>30 minutes, live</h3>
            <p>We open a real agent run — capture, replay, audit record. No slides. Works in your environment.</p>
            <span className="contact-go mono">Book a call →</span>
          </Link>
          <Link className="contact-card" href="/demo">
            <div className="contact-k mono">Security &amp; risk</div>
            <h3>Bring it through review</h3>
            <p>Self-hosting, redaction, the signed audit record, data residency — we&apos;ll join your security review call.</p>
            <span className="contact-go mono">Book a session →</span>
          </Link>
          <Link className="contact-card" href="/demo">
            <div className="contact-k mono">Everything else</div>
            <h3>Pricing, deployment, fit</h3>
            <p>Whether it works with your stack, what a rollout looks like, or how the free tier compares — ask us directly.</p>
            <span className="contact-go mono">Get in touch →</span>
          </Link>
        </div>

        <div className="card" style={{ padding: "1.4rem 1.5rem", marginTop: "2rem", maxWidth: 720 }}>
          <div className="insp-h" style={{ marginTop: 0 }}>What to expect</div>
          <ul style={{ listStyle: "none", display: "grid", gap: "0.6rem", fontSize: "0.92rem", color: "var(--text-secondary)" }}>
            <li>→ A 30-minute call — no deck, we open a real run in your environment.</li>
            <li>→ We reply within one business day.</li>
            <li>→ Deploy on one agent, in your own cloud, in under a week.</li>
          </ul>
        </div>

        <p className="empty" style={{ marginTop: "1.6rem" }}>
          Prefer to look first?{" "}
          <Link href="/how-it-works" style={{ color: "var(--brand)" }}>Walk the interactive scenario</Link>{" "}
          or{" "}
          <Link href="/get-started" style={{ color: "var(--brand)" }}>start free — no card needed</Link>.
        </p>
      </main>
      <Footer />
    </>
  );
}
