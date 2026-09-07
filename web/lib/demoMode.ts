/**
 * Demo mode. runback.dev is a product/marketing site, not the live product — so
 * the endpoints that spend money on real model calls (replay, eval) must never
 * actually call a provider there. With RUNBACK_DEMO_MODE on, they return clearly
 * labelled simulated results and make zero model calls: no cost, nothing to abuse.
 *
 * Self-hosted / customer deployments simply leave the flag unset to get real
 * replay and evaluation.
 */
export const DEMO_MODE = ["1", "true", "yes", "on"].includes(
  (process.env.RUNBACK_DEMO_MODE ?? "").toLowerCase()
);

export const DEMO_NOTE =
  "Demo mode — live replay is off on the hosted site. Self-host Runback to run this against a real model.";

/**
 * Per-account demo. Even on a real deployment that HAS provider keys, these
 * signed-in accounts run fully simulated, zero-cost everywhere — so a salesperson
 * can walk a customer through every feature without spending a cent or risking a
 * real model call. Everyone else is unaffected.
 *
 * Configurable via RUNBACK_DEMO_EMAILS (comma-separated). Defaults to a standard
 * demo login so there's always a credential that "just works" for demos.
 */
// `||`, not `??`: docker-compose passes this through as `${RUNBACK_DEMO_EMAILS:-}`,
// so an unset variable arrives as an EMPTY STRING, which `??` does not treat as
// missing. The list then came out empty, isDemoEmail() returned false for
// everyone, and a self-host running RUNBACK_DEMO_MODE=1 — the documented way to
// try the product without configuring email — had no account anyone could sign
// in with. /api/auth/demo answered "Not a demo account." to its own default.
const DEMO_EMAILS = (process.env.RUNBACK_DEMO_EMAILS || "demo@runback.dev")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Is this email one of the standard demo accounts? */
export function isDemoEmail(email?: string | null): boolean {
  return !!email && DEMO_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Public showcase: the marketing site shows sample agent runs and offers a
 * one-click demo login.
 *
 * Kept SEPARATE from DEMO_MODE, which those things used to be gated on. That
 * conflated two unrelated jobs — "make runback.dev look alive" and "never spend
 * money on a real model call" — into one switch, so the hosted site could only
 * have a populated marketing page by also forcing every signed-up customer into
 * simulated replay. A visitor could not become a user.
 *
 * Defaults to DEMO_MODE so an existing self-host setting RUNBACK_DEMO_MODE=1
 * keeps behaving exactly as before.
 */
export const SHOWCASE = process.env.RUNBACK_SHOWCASE
  ? ["1", "true", "yes", "on"].includes(process.env.RUNBACK_SHOWCASE.toLowerCase())
  : DEMO_MODE;

let showcaseOrgCache: { id: string | null } | null = null;

/**
 * The org whose runs may be shown publicly — the demo account's own workspace.
 *
 * The marketing pages used to call listRuns() with NO org filter and rely on
 * "we only do this in demo mode" as the safety property. That is backwards: on
 * the hosted site DEMO_MODE was on, so runback.dev was publishing every tenant's
 * runs — including input and output text — to an unauthenticated page. It only
 * looked harmless because the only rows belonged to us; the first customer to
 * ingest a run would have appeared on the public homepage.
 *
 * Scoping to a single known org makes the pages safe by construction instead of
 * by flag: no configuration mistake can widen them to real customer data.
 * Returns null when there is no demo account, and the pages then show nothing.
 */
export async function showcaseOrgId(): Promise<string | null> {
  if (process.env.RUNBACK_SHOWCASE_ORG) return process.env.RUNBACK_SHOWCASE_ORG;
  if (showcaseOrgCache) return showcaseOrgCache.id;
  try {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { data: user } = await sb
      .from("users").select("id").in("email", DEMO_EMAILS).limit(1).maybeSingle();
    if (!user) return (showcaseOrgCache = { id: null }).id;
    const { data: memb } = await sb
      .from("memberships").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
    return (showcaseOrgCache = { id: memb?.org_id ?? null }).id;
  } catch {
    return null;
  }
}

/**
 * The per-request demo decision: true if the whole deployment is a demo
 * (RUNBACK_DEMO_MODE) OR the signed-in user is a standard demo account. Safe to
 * call from any server route — reads the session lazily so this module stays
 * importable without pulling auth into client bundles.
 */
export async function isDemoRequest(): Promise<boolean> {
  if (DEMO_MODE) return true;
  const { getSession } = await import("@/lib/auth");
  const session = await getSession().catch(() => null);
  return isDemoEmail(session?.email);
}
