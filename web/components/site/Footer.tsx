"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PRICING_HREF } from "@/lib/edition";

/**
 * Infer which of the four newsletter segments a subscriber belongs to from the
 * page they subscribed on.
 *
 * The subscribe API and the weekly send have supported segments all along, and
 * the send renders a different section order per segment — but this form was the
 * only live caller and it posted `{ email }` alone, so every subscriber landed
 * in "general" and three of the four templates could never be sent. Reading the
 * page is a decent proxy for intent and costs the reader nothing: somebody
 * subscribing from /security is not there for the same reason as somebody
 * subscribing from /docs.
 */
function segmentForPath(pathname: string | null): "developer" | "compliance" | "executive" | "general" {
  if (!pathname) return "general";
  if (/^\/(docs|spec|depth|replay|integrations|how-it-works)/.test(pathname)) return "developer";
  if (/^\/(security|procurement|dpa|privacy|terms|verify|proof)/.test(pathname)) return "compliance";
  if (/^\/(enterprise|pricing|why|vs|use-cases|onboarding)/.test(pathname)) return "executive";
  return "general";
}

function NewsletterForm() {
  const pathname = usePathname();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status !== "idle") return;
    setStatus("sending");
    const res = await fetch("/api/newsletter/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, segment: segmentForPath(pathname) }),
    }).catch(() => null);
    setStatus(res?.ok ? "done" : "error");
  }

  if (status === "done") {
    return <p className="muted" style={{ fontSize: "0.85rem" }}>You&apos;re subscribed. See you Monday.</p>;
  }

  return (
    <form onSubmit={submit} className="ft-nl-form">
      {/* A placeholder is not a label: it vanishes on focus and is not reliably
          announced. This input is on every page, so it was the site's most
          repeated accessibility defect. */}
      <label htmlFor="ft-nl-email" className="sr-only">
        Work email, to subscribe to the newsletter
      </label>
      <input
        id="ft-nl-email"
        type="email"
        required
        placeholder="Work email"
        aria-label="Work email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="ft-nl-input"
      />
      <button type="submit" className="ft-nl-btn" disabled={status === "sending"}>
        {status === "sending" ? "…" : "Subscribe →"}
      </button>
      {status === "error" && <p className="ft-nl-err">Failed — try again.</p>}
    </form>
  );
}

export default function Footer({ selfHosted = false, minimal = false }: { selfHosted?: boolean; minimal?: boolean }) {
  // Auth/onboarding pages (login, get-started) want zero distraction from
  // the task at hand — a sitemap-sized footer with a newsletter signup
  // fights the one thing the page exists to do. Just the legally-necessary
  // row, same links, no sitemap columns.
  if (minimal) {
    return (
      <footer className="site-footer site-footer-minimal">
        <div className="site-footer-legal">
          <span className="muted">© Runback</span>
          {!selfHosted && (
            <span className="site-footer-legal-links">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/dpa">DPA</Link>
            </span>
          )}
        </div>
      </footer>
    );
  }

  // Self-hosted deployments hide every marketing route behind proxy.ts's
  // RUNBACK_SELF_HOSTED gate (redirects to /login) — only /docs, /spec and
  // /verify survive from this footer's links. Rendering the full marketing
  // footer here just gives a real self-host user ~20 links that bounce
  // straight back to /login, so the gated columns are dropped entirely and
  // only the links that actually resolve are kept.
  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <div className="site-footer-brand">
          <span className="brand-name ft-brand-name">Runback</span>
          <p className="ft-tagline">The behavioural system of record for AI agents.</p>
          {!selfHosted && (
            <div className="ft-newsletter">
              <p className="ft-newsletter-label">AI Governance Weekly</p>
              <p className="ft-newsletter-desc">One regulatory update, one incident pattern, one control — every Monday.</p>
              <NewsletterForm />
            </div>
          )}
        </div>

        {selfHosted ? (
          <div className="ftcol">
            <h4>Reference</h4>
            <Link href="/docs">Documentation</Link>
            <Link href="/spec">runback.cassette/v1</Link>
            <Link href="/verify">Verify a record</Link>
          </div>
        ) : (
          <>
            <div className="ftcol">
              <h4>Product</h4>
              <Link href="/how-it-works">How it works</Link>
              <Link href={PRICING_HREF}>Pricing</Link>
              <Link href="/get-started">Get started free</Link>
              <Link href="/onboarding">Onboarding</Link>
              <Link href="/vs">Compare</Link>
              <Link href="/integrations">Integrations</Link>
              <Link href="/docs">Documentation</Link>
            </div>

            <div className="ftcol">
              <h4>Proof</h4>
              <Link href="/how-it-works#incident" scroll={false}>MTTR proof</Link>
              <Link href="/spec">runback.cassette/v1</Link>
              <Link href="/eu-ai-act">EU AI Act Article 12</Link>
              <Link href="/regulatory">All regulatory frameworks</Link>
              <Link href="/changelog">Changelog (hash-chained)</Link>
              <Link href="/transparency">Transparency log</Link>
              <Link href="/verify">Verify a record</Link>
              <Link href="/runs">Demo runs</Link>
              <Link href="/blog">Blog</Link>
              <a href="/feed.xml">RSS feed</a>
            </div>

            <div className="ftcol">
              <h4>Company</h4>
              <Link href="/about">About</Link>
              <Link href="/enterprise">Enterprise</Link>
              <Link href="/security">Security</Link>
              <Link href="/procurement">Procurement</Link>
              <Link href="/status">Status</Link>
              <Link href="/press">Press kit</Link>
              <Link href="/support">Support</Link>
              <Link href="/demo">Book a call</Link>
              <Link href="/contact">Contact</Link>
            </div>
          </>
        )}
      </div>

      <div className="site-footer-legal">
        <span className="muted">© Runback</span>
        {!selfHosted && (
          <span className="site-footer-legal-links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/dpa">DPA</Link>
          </span>
        )}
      </div>
    </footer>
  );
}
