import Link from "next/link";

/**
 * Minimal chrome for auth/onboarding pages (login, get-started) — logo and
 * nothing to click except a way home and a way to the docs. The full
 * marketing Header (5 nav items + "Start free" CTA) competes with the one
 * decision these pages exist to get made; see AuthHeader's callers for the
 * before/after reasoning.
 */
export default function AuthHeader({ selfHosted = false }: { selfHosted?: boolean }) {
  return (
    <>
      <a href="#content" className="skip-link">Skip to content</a>
      <header className="auth-header">
        <Link href="/" className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#0a0b0d" />
            <path d="M23 8 L23 24 L11 16 Z" fill="#e8873d" />
            <path d="M15 8 L15 24 L3 16 Z" fill="#3ecfb8" />
            <rect x="26.6" y="9" width="2.4" height="14" rx="1.2" fill="#f2f0ea" />
          </svg>
          <span className="brand-name">Runback</span>
        </Link>
        {!selfHosted && <Link href="/docs" className="auth-header-link">Docs</Link>}
      </header>
      <div id="content" tabIndex={-1} />
    </>
  );
}
