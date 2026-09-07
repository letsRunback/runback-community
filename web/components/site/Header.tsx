"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";
import { PRICING_HREF } from "@/lib/edition";

function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0a0b0d" />
      <path d="M23 8 L23 24 L11 16 Z" fill="#e8873d" />
      <path d="M15 8 L15 24 L3 16 Z" fill="#3ecfb8" />
      <rect x="26.6" y="9" width="2.4" height="14" rx="1.2" fill="#f2f0ea" />
    </svg>
  );
}

export default function Header({ selfHosted = false }: { selfHosted?: boolean }) {
  const [open, setOpen] = useState(false);

  // Both a fresh page load with a hash (e.g. /kit -> /enterprise#calculator)
  // and clicking a same-page anchor link land the browser's own fragment
  // scroll ~3500px off the real target — reproduced live with a real user
  // click; the target element's own position never moves, so this isn't a
  // layout-shift-after-scroll issue, it's the browser committing to a wrong
  // resting offset for this hash on this page. Re-derive the target's real
  // position ourselves and correct it, on both initial mount and every
  // same-page hash change (a real anchor click fires 'hashchange'; Header
  // itself doesn't remount for those, since no route change happens).
  useLayoutEffect(() => {
    let tickTimer: ReturnType<typeof setTimeout> | undefined;
    let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const TICK_MS = 40;

    // `html { scroll-behavior: smooth }` is global, and both the browser's own
    // built-in scroll-to-hash AND Next.js's router-level hash scroll fire
    // independently of this effect. Cross-page anchor <Link>s now pass
    // scroll={false} so Next never performs its own scroll at all — this
    // effect is the only thing that scrolls to a hash target, on both a hard
    // page load and a client-side route transition.
    //
    // Two things had to be solved to make that reliable, both reproduced
    // live: (1) on a client-side transition, window.location.hash is not yet
    // committed at the exact moment this effect's first synchronous pass
    // runs — checking it once and bailing if empty meant the effect ran but
    // permanently no-opped, since no 'hashchange' event fires for a
    // pushState-based route change to retry later. Poll for the hash to
    // appear instead of checking once. (2) once scrolling, force `auto`
    // (instant) on <html> for the whole correction window — with `smooth` in
    // effect, this loop's own repeated corrective scrolls could stack their
    // own animations and overshoot the target by several hundred px.
    //
    // Uses setTimeout, not requestAnimationFrame: rAF is fully suspended in a
    // backgrounded/hidden tab (confirmed live — a link opened in, or dragged
    // to, a background tab would otherwise never get corrected once it's
    // eventually viewed), where a timer still fires, just throttled.
    function run() {
      const html = document.documentElement;
      const prevBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";

      let id: string | null = null;
      let lastTop: number | null = null;
      let stableFrames = 0;
      let checksAfterSettle = 0;
      const waitingForHashSince = Date.now();
      // Most page loads have no hash at all — don't run a polling loop on
      // every navigation on the chance one shows up late. A hard load or
      // same-page click already has the hash by the first synchronous check
      // below; only the client-side <Link>-transition case needs to wait for
      // it, and only briefly.
      const MAX_WAIT_FOR_HASH_MS = 2000;

      const finish = () => { html.style.scrollBehavior = prevBehavior; };

      const tick = () => {
        if (cancelled) return;
        if (id === null) {
          const hash = window.location.hash;
          if (!hash) {
            if (Date.now() - waitingForHashSince > MAX_WAIT_FOR_HASH_MS) { finish(); return; }
            tickTimer = setTimeout(tick, TICK_MS);
            return;
          }
          id = decodeURIComponent(hash.slice(1));
        }
        const el = document.getElementById(id);
        if (!el) { tickTimer = setTimeout(tick, TICK_MS); return; }
        const top = el.getBoundingClientRect().top;
        const settled = lastTop !== null && Math.abs(top - lastTop) < 1;
        if (settled) stableFrames++; else stableFrames = 0;
        lastTop = top;

        if (stableFrames >= 3) {
          if (Math.abs(top) > 2) {
            el.scrollIntoView({ block: "start" });
            checksAfterSettle = 0;
          } else {
            // Correctly positioned — keep confirming for a short window in
            // case something below still mounts and shifts things again.
            checksAfterSettle++;
            if (checksAfterSettle >= 10) { finish(); return; }
          }
        }
        tickTimer = setTimeout(tick, TICK_MS);
      };
      tick();
      // Never poll forever if the target never stabilizes.
      giveUpTimer = setTimeout(() => { clearTimeout(tickTimer); finish(); }, 6000);
    }
    run();
    // Same-page anchor clicks (hash changes with no route change) still fire
    // 'hashchange' and need their own fresh pass.
    window.addEventListener("hashchange", run);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", run);
      clearTimeout(tickTimer);
      clearTimeout(giveUpTimer);
    };
  }, []);

  return (
    <>
      {/*
        Skip link. The site has no <main> landmark on most pages and /docs has
        48 nav links before its content, so a keyboard or screen-reader user had
        to traverse the whole navigation on every page with no way past it.
        Visually hidden until focused, which is the one time it matters.
      */}
      <a href="#content" className="skip-link">Skip to content</a>
      <header className="site-header">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <Mark />
          <span className="brand-name">Runback</span>
        </Link>
        <nav className="site-nav">
          {/*
            Self-hosted deployments hide every marketing route behind proxy.ts's
            RUNBACK_SELF_HOSTED gate (redirects to /login) — only /docs, /spec,
            /verify, /login and /auth survive. Linking to the gated routes from
            here just bounces a real self-host user straight back to this same
            page, so those links are dropped rather than rendered as dead ends.
          */}
          {!selfHosted && <Link href="/use-cases" className="hide-sm">Use cases</Link>}
          {!selfHosted && <Link href="/how-it-works" className="hide-sm">How it works</Link>}
          {!selfHosted && <Link href="/enterprise" className="hide-sm">Enterprise</Link>}
          {!selfHosted && <Link href={PRICING_HREF} className="hide-sm">Pricing</Link>}
          {/* Dropped from the top nav for the hosted/marketing experience —
              already a footer link, and the top nav reads cleaner without a
              6th item. Kept for self-hosted, where proxy.ts hides every other
              marketing route and /docs is one of the only real destinations
              left in the header. */}
          {selfHosted && <Link href="/docs" className="hide-sm">Docs</Link>}
          <Link href="/login" className="hide-sm nav-signin">Log in</Link>
          {!selfHosted && <Link href="/get-started" className="site-cta">Start free →</Link>}
          <button
            className="nav-hamburger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`ham-bar${open ? " ham-open" : ""}`} />
            <span className={`ham-bar${open ? " ham-open" : ""}`} />
          </button>
        </nav>
      </header>

      {open && (
        <div className="mobile-nav" role="navigation" aria-label="Mobile menu">
          {!selfHosted && <Link href="/use-cases" className="mobile-nav-link" onClick={() => setOpen(false)}>Use cases</Link>}
          {!selfHosted && <Link href="/how-it-works" className="mobile-nav-link" onClick={() => setOpen(false)}>How it works</Link>}
          {!selfHosted && <Link href="/enterprise" className="mobile-nav-link" onClick={() => setOpen(false)}>Enterprise</Link>}
          {!selfHosted && <Link href={PRICING_HREF} className="mobile-nav-link" onClick={() => setOpen(false)}>Pricing</Link>}
          {selfHosted && <Link href="/docs" className="mobile-nav-link" onClick={() => setOpen(false)}>Docs</Link>}
          {!selfHosted && <Link href="/onboarding" className="mobile-nav-link" onClick={() => setOpen(false)}>Onboarding</Link>}
          <Link href="/login" className="mobile-nav-link" onClick={() => setOpen(false)}>Log in</Link>
        </div>
      )}

      {/*
        The skip link's destination. Placed here, after all navigation, so it
        works on every page without editing thirty of them — several have no
        <main> element to aim at. tabIndex -1 lets focus actually land on it,
        which is what makes the skip real rather than a URL change.
      */}
      <div id="content" tabIndex={-1} />
    </>
  );
}
