import Link from "next/link";
import { UPGRADE_HREF, PRICING_HREF, routeAvailable } from "@/lib/edition";

/** Default CTA target; resolveHref below maps it per edition and deployment. */
const PRICING_FALLBACK = PRICING_HREF;

/**
 * Wraps real page content with a blurred, inert overlay and an unlock card —
 * used to show a locked feature's actual page instead of hiding it behind a
 * 404 or an empty upsell block. `children` render for real (so a non-entitled
 * viewer sees exactly what they'd get), then get blurred + pointer-events:none
 * underneath the card. Server-side routes still enforce entitlement on any
 * mutation — this is display only.
 */

// /pricing and /contact are marketing routes: proxy.ts's self-host gate 307s
// them to /login for every request, including an already-authenticated user
// (see web/app/app/upgrade/UpgradeCta.tsx and web/app/not-found.tsx for the
// same fix applied elsewhere). Callers of GateOverlay pass these hrefs
// unaware of self-host, so resolve them here instead of at every call site.
function resolveHref(href: string, selfHosted: boolean): { href: string; external: boolean } {
  // Route existence is a property of the BUILD, not of the deployment, so this
  // check has to come before the self-host early-return below. A Community
  // build served on someone's own cloud without RUNBACK_SELF_HOSTED set still
  // has no /app/upgrade page.
  if (!routeAvailable(href)) {
    return { href: UPGRADE_HREF, external: /^https?:\/\//.test(UPGRADE_HREF) };
  }
  if (!selfHosted) return { href, external: false };
  if (href === "/pricing" || href.startsWith("/pricing?")) {
    // Was a hard-coded "/app/upgrade". In the Community build that route does
    // not exist, so the primary button on roughly a dozen locked pages pointed
    // at a 404 — the most visible thing a self-hoster would click. UPGRADE_HREF
    // is that route in the full build and an absolute runback.dev URL in
    // Community, so the CTA leads somewhere in both.
    return { href: UPGRADE_HREF, external: /^https?:\/\//.test(UPGRADE_HREF) };
  }
  if (href === "/contact" || href.startsWith("/contact?")) {
    const subject = href.includes("subject=")
      ? decodeURIComponent(new URLSearchParams(href.split("?")[1]).get("subject") || "")
      : "";
    return {
      href: `mailto:hello@runback.dev${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`,
      external: true,
    };
  }
  // Anything else the caller passed that this build does not contain. Better a
  // marketing URL that works than an in-app link that 404s.
  if (!routeAvailable(href)) {
    return { href: UPGRADE_HREF, external: /^https?:\/\//.test(UPGRADE_HREF) };
  }
  return { href, external: false };
}

export default function GateOverlay({
  badge,
  title,
  lead,
  ctaHref = PRICING_FALLBACK,
  ctaLabel = "See plans →",
  secondaryHref,
  secondaryLabel,
  children,
}: {
  badge: string;
  title: string;
  lead: string;
  ctaHref?: string;
  ctaLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  children: React.ReactNode;
}) {
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
  const primary = resolveHref(ctaHref, selfHosted);
  const secondary = secondaryHref ? resolveHref(secondaryHref, selfHosted) : null;
  return (
    <div className="gate-wrap">
      <div className="gate-content" aria-hidden>
        {children}
      </div>
      <div className="gate-overlay">
        <div className="gate-lock-card">
          <div className="sde-badge mono">{badge}</div>
          <h2 className="sde-h">{title}</h2>
          <p className="sde-lead">{lead}</p>
          <div className="hero-cta">
            {primary.external ? (
              <a href={primary.href} className="btn-fill">{ctaLabel}</a>
            ) : (
              <Link href={primary.href} className="btn-fill">{ctaLabel}</Link>
            )}
            {secondary && secondaryLabel && (
              secondary.external ? (
                <a href={secondary.href} className="btn-line">{secondaryLabel}</a>
              ) : (
                <Link href={secondary.href} className="btn-line">{secondaryLabel}</Link>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
