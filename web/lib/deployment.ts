/**
 * Which kind of deployment this is, and what that changes.
 *
 * Runback blocks private/RFC1918 hosts when validating outbound targets — SSO
 * issuers, alert webhooks, SIEM collectors. On the multi-tenant hosted service
 * that is correct and load-bearing: it is SSRF protection, and without it one
 * tenant could aim our egress at another tenant's internal network or at cloud
 * metadata endpoints.
 *
 * On a self-hosted deployment the same rule is simply wrong. "Self-host in your
 * VPC" is the product's own pitch, and inside a VPC the identity provider, the
 * alerting proxy and the log collector are all on private addresses by
 * definition. So an operator following the documented deployment found that
 * internal Keycloak was refused as "not a public address" and every alert
 * target in their network was rejected — the features were unreachable exactly
 * where the deployment model put them, and required discovering and setting
 * RUNBACK_ALLOW_PRIVATE_TARGETS=true before anything worked.
 *
 * The distinction is about who the operator is, not about risk appetite. On
 * hosted, the person configuring a webhook is a tenant, and the network they
 * could reach is ours. On self-host they own the machine, the network and the
 * data; there is no boundary left for the check to protect. So the check now
 * defaults to the answer that's actually true for each deployment kind — open
 * on self-host, closed on hosted — rather than closed everywhere with a manual
 * escape hatch self-hosters had to already know exists. Hosted's force-false
 * below is unconditional and cannot be overridden by any env var, so this
 * default flip can never reach the multi-tenant service regardless of
 * misconfiguration. A self-hoster who wants the stricter behavior anyway
 * (e.g. every internal target genuinely IS meant to be unreachable) can still
 * set RUNBACK_ALLOW_PRIVATE_TARGETS=false explicitly to opt back out.
 */

/** True when running on Runback's managed, multi-tenant service. */
export function isHostedService(): boolean {
  return !!process.env.VERCEL;
}

/**
 * This deployment's own public base URL — https://runback.dev on the hosted
 * service, whatever NEXT_PUBLIC_APP_URL a self-hoster set otherwise. Used
 * anywhere a response needs to link back to itself (SCIM discovery documents,
 * page metadata) rather than hardcoding runback.dev, which is wrong on every
 * self-hosted deployment and was three separate copies of the same fallback
 * before this: web/lib/seo.ts, web/app/layout.tsx, and (hardcoded, not even
 * falling back) the three SCIM discovery routes under web/app/api/scim/v2/.
 */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
}

/**
 * Whether outbound targets on private networks are permitted.
 *
 * Force-disabled on the hosted service, unconditionally — no env var read on
 * that branch at all, so it cannot be turned on there by any misconfiguration.
 * Self-hosted defaults to allowed (see this file's header comment for why),
 * with an explicit "false" as the opt-out and "true" kept working for any
 * existing deployment that already set it before this default flipped.
 */
export function allowsPrivateTargets(): boolean {
  if (isHostedService()) return false;
  const raw = process.env.RUNBACK_ALLOW_PRIVATE_TARGETS;
  if (raw === "false") return false;
  if (raw === "true") return true;
  return !!process.env.RUNBACK_SELF_HOSTED;
}
