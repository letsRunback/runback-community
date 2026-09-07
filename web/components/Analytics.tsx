import { Analytics as VercelAnalytics } from "@vercel/analytics/react";

/**
 * Cookieless page analytics, decided on the SERVER.
 *
 * Runback had no acquisition measurement: PLG events record what a user does
 * after signing up, nothing recorded how they arrived. Vercel Web Analytics
 * rather than a paid tool because it is included with the hosting already in
 * use, and cookieless — so /privacy's "no analytics cookies, no consent banner
 * required" stays true.
 *
 * This is deliberately NOT a client component and deliberately does NOT gate on
 * a NEXT_PUBLIC_ variable. Two earlier attempts did and both silently shipped
 * nothing: NEXT_PUBLIC_* values are inlined at BUILD time, so the flag has to
 * exist before the build that reads it, and NEXT_PUBLIC_VERCEL_ENV only exists
 * when a project has "automatically expose system environment variables"
 * switched on — which this one does not. Both failures looked identical from
 * outside: a green deploy, and no data. For the one component whose job is to
 * tell us whether any of this works, a gate that can fail silently is the wrong
 * gate.
 *
 * A server component reads ordinary server env at request time, so the decision
 * is made where the truth already lives. RUNBACK_SELF_HOSTED is set by
 * docker-compose for every self-hosted deployment and nowhere else, so a
 * self-hoster loads nothing and sends nothing without configuring anything —
 * their traffic is theirs. ANALYTICS=off disables it anywhere.
 */
export default function Analytics() {
  if (process.env.ANALYTICS === "off") return null;
  if (process.env.RUNBACK_SELF_HOSTED) return null;
  return <VercelAnalytics />;
}
