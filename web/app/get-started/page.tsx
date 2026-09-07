import Link from "next/link";
import AuthHeader from "@/components/site/AuthHeader";
import { PLAN_INFO } from "@/lib/plans";
import { SHOWCASE } from "@/lib/demoMode";
import Footer from "@/components/site/Footer";
import GetStartedForm from "./GetStartedForm";
import { pageMetadata } from "@/lib/seo";
import { PRICING_HREF } from "@/lib/edition";

export const metadata = pageMetadata({
  path: "/get-started",
  title: "Get started — self-host free or managed cloud",
  description:
    `Get started with Runback — managed cloud from ${PLAN_INFO.starter.priceLabel}, live in minutes, or clone the source and self-host the free Community edition in your own cloud.`,
});

export default function GetStarted() {
  return (
    <>
      <AuthHeader />
      <main className="auth-page">
        <div className="auth-card auth-card-wide">
          <span className="mk-eyebrow">Get started</span>
          <h1 className="auth-h1">Start free.</h1>
          <p className="auth-lead">Managed cloud, live in 5 minutes — or self-host free in your own cloud.</p>

          <ol className="gs-steps">
            <li>
              <span className="gs-step-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16v12H4z" stroke="currentColor" strokeWidth="1.8" /><path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </span>
              Sign up, no card
            </li>
            <li>
              <span className="gs-step-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 14a4 4 0 108-1.5" stroke="currentColor" strokeWidth="1.8" /><path d="M11 12.5L18 5.5l1.5 1.5-1 1 1.5 1.5-2 2-1.5-1.5-1 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              Paste a 3-line snippet
            </li>
            <li>
              <span className="gs-step-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" /><path d="M8 12.5l2.5 2.5L16.5 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              First trace in your dashboard
            </li>
          </ol>

          {/*
            Every orange "Start free" on the site lands here, and what greeted it
            was a lead-capture form for the self-host edition — no account created,
            nothing to use in the session. The one path that actually creates a
            workspace in five minutes was a low-contrast "Log in" link in the
            header, which a first-time visitor has no reason to click.

            One clear primary door, not two equal-weight boxes — self-host and
            "just looking" are real paths, but they're not the default one.
          */}
          <Link href="/login" className="gs-door gs-door-primary">
            <span className="gs-door-k mono">Managed cloud · 5 minutes</span>
            <strong>Create your workspace →</strong>
            <span className="gs-door-b">
              Passwordless — we email you a link and it creates the workspace. No
              card, no infrastructure.
            </span>
          </Link>

          {/* The "5 minutes" above is the human setup path (workspace, key,
              paste the snippet) — a separate, measured claim about what happens
              once your agent actually sends a trace: see
              web/scripts/bench/ingest-latency.ts for methodology. */}
          <p className="auth-secondary" style={{ marginTop: "0.9rem" }}>
            Once your agent sends its first trace, it lands in your dashboard in
            under 100ms — <Link href="/docs#sdk-manual" className="mk-link">see the 3-line snippet</Link>.
          </p>

          <p className="auth-secondary">
            {/* Only shown when the demo login actually works — SHOWCASE off (the
                default for a self-host that hasn't opted in) makes /api/auth/demo
                404, so promising "no sign-up at all" here would be a dead end. */}
            {SHOWCASE && (
              <>
                <Link href="/login" className="mk-link">Explore the live demo — no sign-up</Link>
                {" · "}
              </>
            )}
            <Link href="/runs" className="mk-link">See a real run, no login</Link>
            {" · "}
            <Link href="/docs" className="mk-link">Read the docs</Link>
          </p>

          <div className="gs-or mono">or self-host, free</div>

          <div className="gs-selfhost">
            <p className="gs-selfhost-lead">
              The Community edition — full SDK, deterministic replay, evals + CI
              gate, signed audit export — self-hosted in your own cloud, so your
              data never leaves your perimeter. The source is public — clone{" "}
              <a href="https://github.com/letsRunback/runback-community" className="mk-link">runback-community</a>{" "}
              and run it, no request needed.{" "}
              Prefer managed hosting with no infra?{" "}
              <Link href={PRICING_HREF} className="mk-link">See plans from {PLAN_INFO.starter.priceLabel} →</Link>
            </p>
            <GetStartedForm emailEnabled={!!process.env.RESEND_API_KEY} />
          </div>
        </div>
      </main>
      <Footer minimal />
    </>
  );
}
