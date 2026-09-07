/**
 * Server-side feature gate for API routes. The UI hides paid features, but the
 * routes that EXECUTE them (whole-run counterfactual replay, bisection, …) must
 * enforce the entitlement themselves — otherwise a direct API call bypasses the
 * paywall and spends real model tokens. This is the one place that resolves an
 * org's effective, trial-aware plan and checks a feature.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { featurePlan, can, type Feature } from "@/lib/entitlements";

/**
 * Does the org behind `orgId` have `feature`? Trial-aware. For a null org
 * (self-host single-tenant / legacy), falls back to the license-driven plan
 * (`can(null, …)` consults RUNBACK_LICENSE), so the Community edition is gated and
 * a signed Enterprise license unlocks it.
 */
export async function orgHasFeature(orgId: string | null | undefined, feature: Feature): Promise<boolean> {
  if (!orgId) return can(null, feature); // self-host: license decides
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: org } = await sb.from("orgs").select("plan,trial_ends_at").eq("id", orgId).maybeSingle();
  return can(featurePlan(org ?? { plan: null }), feature);
}

/** Thrown when a licensed (Enterprise) capability is invoked without entitlement. */
export class LicenseError extends Error {
  constructor(public feature: Feature) {
    super(`"${feature}" is a licensed Runback capability — a valid plan or RUNBACK_LICENSE is required to activate it.`);
    this.name = "LicenseError";
  }
}

/**
 * Fail-CLOSED license assertion, called INSIDE each Enterprise engine orchestrator
 * (deep replay, bisection, golden, …) as a second layer beneath the route gate.
 * Because the source is available to licensed customers (GitLab-style), gating only
 * at the route would let a patched route unlock the engine; re-asserting here means
 * an attacker must find and remove every check. Demo accounts are exempt. Throws
 * {@link LicenseError} if the org/license is not entitled.
 */
export async function assertFeature(
  orgId: string | null | undefined,
  feature: Feature,
  demo = false
): Promise<void> {
  if (demo) return;
  if (!(await orgHasFeature(orgId, feature))) throw new LicenseError(feature);
}
