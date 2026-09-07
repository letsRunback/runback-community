"use client";

import { Analytics as VercelAnalytics } from "@vercel/analytics/react";

/**
 * Cookieless page analytics, on infrastructure we already pay for.
 *
 * Runback has no acquisition measurement at all: PLG events record what a user
 * does AFTER signing up (first_run_captured, first_eval_run), but nothing
 * records how anyone arrived. Launching into a funnel you cannot see means
 * repeating whatever felt productive rather than whatever worked.
 *
 * Vercel Web Analytics rather than Plausible — which this file used briefly —
 * for the plainest reason available: Plausible is a paid subscription, and a
 * company with no customers yet should not add a recurring bill to answer a
 * question its existing host already answers. Vercel is the host, so this adds
 * no vendor relationship and no new place customer data could go.
 *
 * The privacy constraint that drove the original choice still holds. /privacy
 * says: "No analytics, tracking, or advertising cookies are deployed on this
 * site. Because we use only strictly necessary cookies, no consent banner is
 * required." Vercel Web Analytics is cookieless and stores no cross-site
 * identifiers, so that sentence stays true and no banner appears.
 *
 * Off unless NEXT_PUBLIC_ANALYTICS is set, so the Community edition and every
 * self-hosted deployment load nothing and send nothing. Not a courtesy: a
 * self-hoster's traffic is theirs, and phoning home would contradict the reason
 * they self-host.
 */
export default function Analytics() {
  if (process.env.NEXT_PUBLIC_ANALYTICS !== "on") return null;
  return <VercelAnalytics />;
}
