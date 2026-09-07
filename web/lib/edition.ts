/**
 * Community build: the commercial and Enterprise-only routes are not in this
 * tree. See the full-build edition.ts for why this is keyed off edition rather
 * than the self-hosted flag.
 *
 * Pricing and upgrade point at runback.dev rather than being removed: a
 * self-hoster who wants the hosted product or an Enterprise licence needs
 * somewhere to go, and a dead "Upgrade" button is worse than an outbound one.
 */

export const COMMUNITY_BUILD = true;

export const UNAVAILABLE_ROUTES: ReadonlySet<string> = new Set<string>([
  "/pricing",
  "/app/upgrade",
  "/app/alerts",
  "/app/benchmark",
  "/app/regulatory",
]);

export const PRICING_HREF = "https://runback.dev/pricing";
export const UPGRADE_HREF = "https://runback.dev/pricing";

export function routeAvailable(href: string): boolean {
  if (/^https?:\/\//.test(href)) return true;
  return !UNAVAILABLE_ROUTES.has(href.split(/[?#]/)[0]);
}
