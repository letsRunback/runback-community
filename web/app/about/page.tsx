import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/about",
  title: "About — the Tao of Runback",
  description:
    "What we believe about AI agent governance, and how a small team actually builds it: reproduce over recount, prove over assert, block before it ships.",
});

const TENETS: { k: string; v: string }[] = [
  {
    k: "Reproduce, don't recount.",
    v: "A log tells you what happened, not why — and it can't be re-run. Every mechanism we build starts from re-execution: hold the context fixed, run the model fresh, see if behavior actually changed. A description of a decision is not the decision.",
  },
  {
    k: "Prove it, or it didn't happen.",
    v: "\"Trust us\" is not evidence. Every run seals into a hash-chained record that verifies independently of Runback — you can check our math without asking our permission. If a claim can't be verified by someone who doesn't trust us yet, we don't get to make it.",
  },
  {
    k: "Block before it ships, not after it breaks.",
    v: "Catching a regression in a retro is catching it too late. A policy simulated against real production history, then enforced as a release gate, stops the bad deploy before a customer sees it — the same control, moved earlier.",
  },
  {
    k: "Your agents, your perimeter.",
    v: "We don't need your data to prove the product works — we need your agents to keep running inside your boundary. Self-hosting isn't a compliance checkbox we bolted on; it's the default we'd want if we were the customer.",
  },
  {
    k: "Every failure is a future test.",
    v: "An incident that doesn't turn into a regression test is a lesson that gets relearned. The failures your team already survived are the highest-signal test suite you have — we'd rather mine them than write synthetic ones from scratch.",
  },
  {
    k: "Open where trust is cheap. Guarded where it's expensive.",
    v: "Standard GenAI OpenTelemetry ingestion is open — there's nothing defensible about a span format. The replay and audit core is not, because that's the part that has to be right every single time, and giving it away wouldn't make it more correct, just less maintained.",
  },
];

export default function About() {
  return (
    <>
      <Header />

      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">About</span>
          <h1 className="hero-h1" style={{ maxWidth: "20ch" }}>
            The <span className="accent">Tao of Runback</span>.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "64ch" }}>
            Not a mission statement — the actual rules we build against. If a
            feature can&apos;t be justified by one of these, we don&apos;t ship it.
          </p>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <div className="cap-grid">
            {TENETS.map((t) => (
              <div className="cap" key={t.k}>
                <div className="cap-k mono">{t.k}</div>
                <p>{t.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">How we actually work</span>
          <h2 className="mk-h2">Small, and not pretending otherwise.</h2>
          <p className="mk-lead" style={{ marginBottom: "1.6rem", maxWidth: "62ch" }}>
            We&apos;re a small team building a product we&apos;d bet a production
            incident on. No account managers, no layers between you and the
            code — a few practical consequences of that:
          </p>
          <div className="faq" style={{ marginTop: "1rem" }}>
            <div className="faq-q">
              <h4>The tests are public, not a claim</h4>
              <p>
                Every layer of the replay engine is proven in{" "}
                <a href="https://github.com/letsRunback/runback-proofs/actions" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
                  public CI ↗
                </a>
                . We don&apos;t get to say &quot;it works&quot; without also
                showing you the run that proves it.
              </p>
            </div>
            <div className="faq-q">
              <h4>Security review, no hand-off</h4>
              <p>
                When you send a security questionnaire, the person answering
                it is the person who wrote the code you&apos;re asking about
                — not a sales engineer relaying answers from Slack.
              </p>
            </div>
            <div className="faq-q">
              <h4>No customer logos here — yet</h4>
              <p>
                We&apos;re early. Rather than dress that up with stock-photo
                testimonials, we&apos;d rather you judge the product on the
                worked incident on{" "}
                <Link href="/how-it-works" style={{ color: "var(--brand)" }}>/how-it-works</Link>{" "}
                and the code that runs it.
              </p>
            </div>
            <div className="faq-q">
              <h4>Small is a constraint, not a pitch</h4>
              <p>
                It means slower feature sprawl and a shorter roadmap than a
                funded team would ship. It also means every decision on this
                page was actually argued about by the people who build the
                product, not handed down from a deck.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-cta-band">
        <div className="mk">
          <h2>Judge it on the work.</h2>
          <p>Walk a real incident, or read the spec the ledger is built on.</p>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <Link href="/how-it-works" className="btn-fill">Walk the incident →</Link>
            <Link href="/spec" className="btn-line">Read the spec</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
