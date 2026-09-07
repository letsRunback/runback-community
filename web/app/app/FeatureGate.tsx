import GateOverlay from "./GateOverlay";

/**
 * The render half of the pattern started in web/lib/featureAccess.ts: given
 * the `allowed` decision already resolved (with data already fetched or
 * fixture-filled), either show children as-is or wrap them in GateOverlay.
 * DRYs up the `entitled ? body : <GateOverlay ...>{body}</GateOverlay>`
 * branch repeated at the bottom of every gated page.
 */
export default function FeatureGate({
  allowed,
  badge,
  title,
  lead,
  ctaHref,
  ctaLabel,
  secondaryHref,
  secondaryLabel,
  children,
}: {
  allowed: boolean;
  badge: string;
  title: string;
  lead: string;
  ctaHref?: string;
  ctaLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  children: React.ReactNode;
}) {
  if (allowed) return <>{children}</>;
  return (
    <GateOverlay
      badge={badge}
      title={title}
      lead={lead}
      ctaHref={ctaHref}
      ctaLabel={ctaLabel}
      secondaryHref={secondaryHref}
      secondaryLabel={secondaryLabel}
    >
      {children}
    </GateOverlay>
  );
}
