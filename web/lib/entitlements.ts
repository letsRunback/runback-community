/**
 * Plan entitlements — the monetization gate. One codebase; Enterprise features
 * are off on the free plan and unlocked by Pro/Enterprise (cloud subscription)
 * or a self-host commercial license.
 *
 * Self-host: the Community edition runs free (core dev-tools). Enterprise features
 * are LOCKED unless RUNBACK_LICENSE holds a Runback-signed license token — a plain
 * string like "enterprise" does nothing. Cloud: the org's `plan` decides.
 */
import { verifyLicense } from "@/lib/license";
import { isHostedService } from "@/lib/deployment";
import { RETENTION_FLOOR_DAYS, VERTICALS, type Vertical } from "@/lib/verticals";

export type Plan = "free" | "starter" | "growth" | "scale" | "pro" | "enterprise";

export type Feature =
  | "alerting"
  | "rbac"              // teams beyond the owner
  | "dashboard"         // the fleet control room
  | "quality"           // golden suite — auto-mines regressions from incidents
  | "sso"
  | "ledger"            // org-wide tamper-evident ledger
  | "long_retention"
  | "deep_replay"       // environment-deterministic capture, replay depth & scoring
  | "corpus"            // fleet anomaly signals mined from the cassette corpus
  | "model_attribution" // per-model error rate, latency, and cost attribution
  | "multiagent"        // agent-to-agent trace stitching and graph view
  | "compliance"        // compliance artifact generation (SOC 2, ISO 27001)
  | "proof"             // policy-as-cryptographic-proof bundles with Merkle inclusion
  | "policy_library"    // community policy template library + one-click import
  | "policy_simulation" // simulate policy rules against historical decisions before enabling
  | "model_diff"        // semantic behavioral diff between model versions
  | "upgrade_gate"      // CI gate: run golden suite against a new model before switching
  | "cost_attribution"  // cost breakdown by model/agent + optimization recommendations
  | "benchmark"         // fleet percentile benchmarks vs anonymised peer orgs
  | "regulatory"        // named regulatory framework mappings (EU AI Act, ISO 42001)
  | "policy_causes"     // policy causal attribution heat-map (which policies × agents block most)
  | "chargeback"        // per-team cost attribution with budget caps
  | "trust_chain"       // inter-agent trust chain with signed (Ed25519-preferred) delegation proofs
  | "step_replay"       // re-execute a specific LLM call with a different model
  | "topology"          // fleet DAG topology view — agent call graph and flame charts
  | "approvals"         // human-in-the-loop review queue for high-stakes decisions
  | "incidents"         // incident response loop with auto-RCA
  | "drift"             // behavioral drift detection — silent upstream model changes
  | "guard";            // live-ish kill-switch: sampled replay can revoke an agent's authorization mid-run

// Which plans include which features.
/**
 * Capabilities the Runback Community Licence grants unconditionally, on every
 * plan including free, self-hosted or hosted.
 *
 * LICENSE, LICENSING.md, README and /pricing all describe the Community
 * edition as including run capture, deterministic time-travel replay and the
 * signed re-executable audit record. The code granted none of them: free was
 * empty, step_replay started at pro and ledger at enterprise, and a self-host
 * install resolves to `free` because the licence explicitly needs no token. So
 * the licence granted rights the code refused, and the public README promised
 * "nothing crippled" over three crippled headline features.
 *
 * Only flags with exactly one meaning belong here. `quality` and
 * `upgrade_gate` are deliberately absent despite the licence naming evals and
 * the release gate: those flags are shared with Golden corpus, prompt
 * management, pairwise comparison and judge calibration, so granting the flag
 * would silently unlock four things Community does not promise. Those two are
 * granted per-capability at their routes instead — see communityCapability().
 */
const COMMUNITY_LICENCE_FEATURES: Feature[] = ["step_replay", "ledger"];

/**
 * Spread into every tier so the table is cumulative by construction.
 *
 * Each tier used to re-list the one below it by hand, and can() reads a single
 * plan's list rather than walking up the order — so adding a feature to a
 * lower tier silently REMOVED it from higher ones unless all six arrays were
 * edited together. The monotonicity test in __tests__/entitlements.test.ts
 * pins this; it catches the exact mistake.
 */
const PLAN_FEATURES: Record<Plan, Feature[]> = {
  free: [...COMMUNITY_LICENCE_FEATURES],
  starter: [...COMMUNITY_LICENCE_FEATURES, "alerting", "rbac", "approvals"],
  growth: [...COMMUNITY_LICENCE_FEATURES, "alerting", "rbac", "quality", "approvals", "incidents"],
  scale: [
    ...COMMUNITY_LICENCE_FEATURES,
    "alerting", "rbac", "quality", "approvals", "incidents",
    "dashboard", "policy_library", "policy_simulation",
    "model_diff", "upgrade_gate", "cost_attribution", "drift",
    "model_attribution", "policy_causes", "topology",
  ],
  pro: [
    ...COMMUNITY_LICENCE_FEATURES,
    "alerting", "rbac", "quality", "approvals", "incidents",
    "dashboard", "policy_library", "policy_simulation",
    "model_diff", "upgrade_gate", "cost_attribution", "drift",
    "corpus", "model_attribution", "multiagent",
    "benchmark", "policy_causes", "trust_chain", "topology",
  ],
  enterprise: [
    ...COMMUNITY_LICENCE_FEATURES,
    "alerting", "rbac", "dashboard", "quality", "approvals", "incidents",
    "sso", "long_retention", "deep_replay",
    "corpus", "model_attribution", "multiagent",
    "compliance", "proof",
    "policy_library", "policy_simulation",
    "model_diff", "upgrade_gate", "cost_attribution", "drift",
    "benchmark", "regulatory", "policy_causes", "chargeback", "trust_chain", "topology",
    "guard",
  ],
};

/**
 * Self-host edition, from a Runback-SIGNED license token in RUNBACK_LICENSE.
 * Without a valid signed license, the instance is the free Community edition —
 * an arbitrary string like "enterprise" is rejected.
 */
function selfHostEdition(): Plan {
  const lic = verifyLicense(process.env.RUNBACK_LICENSE);
  return lic?.plan ?? "free";
}

export const PLAN_ORDER: Plan[] = ["free", "starter", "growth", "scale", "pro", "enterprise"];

/** The lowest tier (in PLAN_ORDER) that unlocks a feature, or null if it's on no plan (dev-only/unreachable). */
export function minPlanFor(feature: Feature): Plan | null {
  return PLAN_ORDER.find((p) => PLAN_FEATURES[p].includes(feature)) ?? null;
}

/** Effective plan = max(org plan, self-host license). */
export function effectivePlan(orgPlan: Plan | string | null | undefined): Plan {
  if (orgPlan && !PLAN_ORDER.includes(orgPlan as Plan)) {
    console.warn(`[entitlements] unknown plan "${orgPlan}" — defaulting to free. Add it to PLAN_ORDER if this is a new tier.`);
  }
  const op = (PLAN_ORDER.includes(orgPlan as Plan) ? orgPlan : "free") as Plan;
  const lic = selfHostEdition();
  return PLAN_ORDER[Math.max(PLAN_ORDER.indexOf(op), PLAN_ORDER.indexOf(lic))];
}

export function can(orgPlan: Plan | string | null | undefined, feature: Feature): boolean {
  return PLAN_FEATURES[effectivePlan(orgPlan)].includes(feature);
}

/**
 * Self-hosted — with or without a RUNBACK_LICENSE — gets "evals + the
 * release gate" for free. LICENSE-COMMUNITY grants it unconditionally
 * ("install, run, and use... at no charge and without a license token") and
 * LICENSING.md lists it under the Community edition, not Enterprise.
 *
 * Deliberately NOT folded into can()/orgHasFeature(): eval creation and the
 * release-gate verdict ride the same "quality"/"upgrade_gate" flags as Golden
 * (regression mining) and the prompt/pairwise/calibration features, all of
 * which LICENSING.md puts under Enterprise or doesn't mention at all — a
 * blanket grant on those flags would silently unlock them too. So this is
 * checked explicitly at only the two routes the Community promise actually
 * covers (POST /api/evals, GET /api/evals/:id/gate).
 *
 * This used to return !isHostedService(), on the reasoning that the hosted
 * free tier is a sales funnel rather than a licence grant. That reasoning was
 * sound in isolation and wrong in aggregate: it left a lapsed hosted trial with
 * 25 of 39 pages locked, and it made the pricing page's Community column mean
 * something different from the Free column beside it. The hosted free tier now
 * mirrors the Community edition deliberately, so this is unconditional.
 *
 * It stays a FUNCTION rather than becoming a constant because it still marks
 * the two specific routes the licence covers. Folding it into can() would grant
 * the whole `quality`/`upgrade_gate` flags, which also carry Golden, prompt
 * management, pairwise comparison and judge calibration — four capabilities
 * Community does not promise. That separation is the entire point.
 */
export function communityEvalGate(): boolean {
  return true;
}

/* ── usage limits ─────────────────────────────────────────────────────────── */

export interface PlanLimits {
  runsPerMonth: number; // Infinity = unmetered
  retentionDays: number;
  seats: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free:       { runsPerMonth: 1_000,   retentionDays: 7,        seats: 1        },
  starter:    { runsPerMonth: 20_000,  retentionDays: 30,       seats: 5        },
  growth:     { runsPerMonth: 50_000,  retentionDays: 60,       seats: 10       },
  scale:      { runsPerMonth: 75_000,  retentionDays: 60,       seats: 20       },
  pro:        { runsPerMonth: 100_000, retentionDays: 90,       seats: 25       },
  enterprise: { runsPerMonth: Infinity, retentionDays: Infinity, seats: Infinity },
};

export function limits(orgPlan: Plan | string | null | undefined): PlanLimits {
  return PLAN_LIMITS[effectivePlan(orgPlan)];
}

/* ── free trial ───────────────────────────────────────────────────────────── */

export const TRIAL_DAYS = 14;
// Full features, but capped execution — enough to evaluate, not to run on us.
const TRIAL_LIMITS: PlanLimits = { runsPerMonth: 5000, retentionDays: 14, seats: 5 };

export interface OrgRef {
  plan?: string | null;
  trial_ends_at?: string | null;
  vertical?: string | null;
}

/** Is this org inside an active trial (free plan + unexpired trial)? */
export function trialActive(org: OrgRef): boolean {
  return effectivePlan(org.plan) === "free" && !!org.trial_ends_at && new Date(org.trial_ends_at) > new Date();
}

/** Effective FEATURE plan, trial-aware (a trial unlocks Pro features). */
export function featurePlan(org: OrgRef): Plan {
  if (trialActive(org)) return "pro";
  return effectivePlan(org.plan);
}

/**
 * Retention floor days for the org's declared vertical, or 0 if none/unset.
 * Regulated verticals (healthcare, fintech, legal) get a real minimum
 * regardless of plan tier — see RETENTION_FLOOR_DAYS for the rationale.
 */
function verticalRetentionFloor(org: OrgRef): number {
  const v: Vertical = org.vertical && org.vertical in VERTICALS ? (org.vertical as Vertical) : "general";
  return RETENTION_FLOOR_DAYS[v];
}

/**
 * Usage limits, trial-aware (a trial gets capped execution) AND
 * vertical-floored: retentionDays is never lower than the org's declared
 * industry's recordkeeping floor, even on a plan that would otherwise
 * grant less.
 */
export function usageLimits(org: OrgRef): PlanLimits {
  const base = trialActive(org) ? TRIAL_LIMITS : PLAN_LIMITS[effectivePlan(org.plan)];
  const floor = verticalRetentionFloor(org);
  if (floor === 0 || base.retentionDays >= floor) return base;
  return { ...base, retentionDays: floor };
}
