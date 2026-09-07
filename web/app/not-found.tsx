import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { PRICING_HREF } from "@/lib/edition";

export const metadata = {
  title: "Page not found",
  // A 404 must never be indexed — it has no content and would compete with
  // real pages. Next returns the 404 status regardless; this stops a crawler
  // that followed a stale link from keeping the URL in the index.
  robots: { index: false, follow: true },
};

// Same reasoning as docs/page.tsx: RUNBACK_SELF_HOSTED is only present in the
// running container's environment (docker-compose), not at `docker build`
// time, so without force-dynamic the selfHosted-aware filtering below gets
// baked in as `false` forever by static prerendering of /_not-found, and a
// self-hosted visitor who lands on a 404 is offered marketing destinations
// (/pricing, /get-started, /contact) that all dead-end back to /login.
export const dynamic = "force-dynamic";

/**
 * The default Next 404 is a dead end. Most visitors who reach one arrived from
 * a stale link or a typo and already wanted something specific, so the useful
 * thing is a short list of where they were probably going — not an apology.
 */
const DESTINATIONS: { href: string; k: string; body: string }[] = [
  {
    href: "/how-it-works",
    k: "How it works",
    body: "Capture, replay, gate and audit — with the same production incident resolved two ways.",
  },
  {
    href: "/docs",
    k: "Documentation",
    body: "Quick start, SDK reference, self-host guide and the full API.",
  },
  {
    href: "/spec",
    k: "runback.cassette/v1",
    body: "The open record format, and how to verify one without an account.",
  },
  {
    href: PRICING_HREF,
    k: "Pricing",
    body: "Every tier, what each includes, and where the limits sit.",
  },
  // The page listed four places to read about the product and no way to use it,
  // which is a strange thing to do to someone who is already here.
  {
    href: "/get-started",
    k: "Start free",
    body: "Create a workspace in five minutes, or open the live demo without signing up.",
  },
];

export default function NotFound() {
  // See app/docs/page.tsx: on a self-hosted deployment, proxy.ts redirects
  // every route except /docs, /spec, /verify, /login, /auth and /app to
  // /login — so most of DESTINATIONS (and /contact below) would be dead
  // links here too. Only offer what actually resolves.
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
  const destinations = selfHosted
    ? DESTINATIONS.filter((d) => d.href === "/docs" || d.href === "/spec")
    : DESTINATIONS;
  return (
    <>
      <Header selfHosted={selfHosted} />
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">404</span>
          <h1 className="mk-h2">That page isn&apos;t here.</h1>
          <p className="mk-lead" style={{ marginBottom: "2rem" }}>
            It may have moved as the site was reorganised, or the link may be wrong.{" "}
            {selfHosted ? (
              <>Check <Link href="/docs" className="mk-link">/docs</Link> for the page you were after.</>
            ) : (
              <>A few pages merged recently — <Link href="/how-it-works" className="mk-link">/how-it-works</Link> now
              carries what used to live on several.</>
            )}
          </p>

          <div className="cap-grid">
            {destinations.map((d) => (
              <Link className="cap" key={d.href} href={d.href}>
                <div className="cap-k mono">{d.k}</div>
                <p>{d.body}</p>
              </Link>
            ))}
          </div>

          {!selfHosted && (
            <p className="mk-lead" style={{ marginTop: "2rem", fontSize: "0.9rem" }}>
              Still stuck? <Link href="/contact" className="mk-link">Tell us what you were looking for</Link> —
              a 404 from a link we published is our problem to fix.
            </p>
          )}
        </div>
      </section>
      <Footer selfHosted={selfHosted} />
    </>
  );
}
