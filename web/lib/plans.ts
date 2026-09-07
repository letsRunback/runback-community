/**
 * Single source of truth for plan name, price, tagline and feature list — the
 * copy that keeps drifting across web/app/pricing, web/app/app/upgrade,
 * web/app/press and every GateOverlay badge (each hand-typed its own; press
 * once had Growth at $200/mo while everywhere else said $600/mo).
 *
 * The name/price half was centralised earlier. The FEATURE half was not, and
 * the two pricing pages had already diverged on what a customer actually gets:
 *
 *   Pro    /pricing        "Full platform, named support, managed SLA."
 *                          … Quarterly governance review
 *          /app/upgrade    "Fleet benchmarks & deep governance."
 *                          … Inter-agent trust chain · signed delegation proofs
 *                          (no governance review)
 *   Scale  /pricing        4 bullets
 *          /app/upgrade    5 bullets (extra: policy causal attribution heat-map)
 *   Starter, Enterprise, Community — all differed in wording
 *
 * Same tier, same price, two different promises depending on which page the
 * customer happened to read. That is a commitment problem, not a copy problem,
 * so the bullets live here now and both pages render from them.
 *
 * Usage limits (seats/runs/retention) are still NOT duplicated here — those
 * live in PLAN_LIMITS (entitlements.ts) and callers should read that directly.
 */
import { type Plan, type Feature, PLAN_ORDER, minPlanFor } from "./entitlements";

export interface PlanInfo {
  key: Plan;
  name: string;
  /** The number alone: "Free" | "A$49" | "Custom". */
  /**
   * Displayed with the currency symbol, and it is A$ deliberately.
   *
   * Billing runs through a Lemon Squeezy store whose currency is AUD — a
   * store-level setting, not per-product. A bare "$49" reads as USD to most
   * of the market, and the buyer then meets A$49 at checkout: a currency they
   * did not expect, at the moment of commitment. Quoting the currency we
   * actually charge is the cheaper of the two surprises.
   */
  priceAmount: string;
  /** Billing period, when there is one: "/mo". Null for Free and Custom. */
  pricePeriod: string | null;
  /** Display string: "Free" | "A$49/mo" | "Custom". Derived — never hand-typed. */
  priceLabel: string;
  tagline: string;
  /** What the tier includes. Rendered verbatim by /pricing and /app/upgrade. */
  features: string[];
}

type PlanSeed = Omit<PlanInfo, "priceLabel">;

const SEED: Record<Plan, PlanSeed> = {
  free: {
    key: "free", name: "Community", priceAmount: "Free", pricePeriod: null,
    // Named for the self-host edition, but this is also the tier every hosted
    // signup lands on when its 14-day trial lapses — the card said "Self-host
    // forever" with residency "Your infra", so the hosted free tier appeared
    // nowhere on the pricing page at all. The run/retention limits below apply
    // to both (meterIngest caps on plan, not on deployment type).
    tagline: "Self-host forever, or stay free on our cloud. Single workspace.",
    features: [
      "Full SDK + self-hostable core",
      "Observe · replay · signed audit",
      "CI release gate · PII redaction",
      "Any model · OpenTelemetry compatible",
      "Single workspace · 1,000 runs/mo · 7-day retention",
    ],
  },
  starter: {
    key: "starter", name: "Starter", priceAmount: "A$49", pricePeriod: "/mo",
    tagline: "Small team, managed — no infra to run.",
    features: [
      "Everything in Community, hosted",
      "Team & roles (RBAC) · 5 seats",
      "Alerting — email · Slack · webhook",
      "20,000 runs/mo · 30-day retention",
    ],
  },
  growth: {
    key: "growth", name: "Growth", priceAmount: "A$600", pricePeriod: "/mo",
    tagline: "Teams with agents in production.",
    features: [
      "Everything in Starter · 10 seats · 50k runs",
      "Golden corpus — incidents auto-mined into regression tests",
      "Eval runner + CI gate · dataset management",
      "Versioned prompt registry + playground",
      "Pairwise eval comparison + judge calibration",
      "60-day retention · multi-workspace",
    ],
  },
  scale: {
    key: "scale", name: "Scale", priceAmount: "A$1,800", pricePeriod: "/mo",
    tagline: "Multi-team, fleet visibility, policy control.",
    features: [
      "Everything in Growth · 20 seats · 75k runs",
      "Fleet control-room dashboard",
      "Policy simulation + library",
      "Model diff · upgrade gate · cost attribution",
      "Policy causal attribution heat-map",
    ],
  },
  pro: {
    key: "pro", name: "Pro", priceAmount: "A$5,000", pricePeriod: "/mo",
    tagline: "Full platform, named support, managed SLA.",
    features: [
      "Everything in Scale · 25 seats · 100k runs · 90-day retention",
      "Fleet benchmarks vs. vertical peers",
      "Inter-agent trust chain · signed delegation proofs",
      "Live runtime enforcement · advanced bisection",
      "Priority support · named contact · SLA",
    ],
  },
  enterprise: {
    key: "enterprise", name: "Enterprise", priceAmount: "Custom", pricePeriod: null,
    tagline: "For regulated environments.",
    features: [
      "Everything in Pro, in your perimeter",
      "SSO (OIDC) · managed audit keys · legal holds",
      "Unmetered runs · unlimited retention",
      "Self-host in your VPC · data residency",
      "Regulatory dashboard — EU AI Act · ISO 42001 · NIST AI RMF · APRA CPS 230/234 · GDPR · ISO 27001",
      "Team chargeback with monthly budget caps",
      "Named support · SLAs · security review",
    ],
  },
};

export const PLAN_INFO: Record<Plan, PlanInfo> = Object.fromEntries(
  Object.entries(SEED).map(([k, v]) => [
    k,
    { ...v, priceLabel: `${v.priceAmount}${v.pricePeriod ?? ""}` },
  ])
) as Record<Plan, PlanInfo>;

/** Every tier, cheapest first — the order both pricing surfaces render in. */
export const PLANS_IN_ORDER: PlanInfo[] = PLAN_ORDER.map((p) => PLAN_INFO[p]);

/** e.g. "Starter · Growth · Scale · Pro · Enterprise" for a GateOverlay badge — derived from the real entitlement, not hand-typed. */
export function planBadgeText(feature: Feature): string {
  const min = minPlanFor(feature);
  if (!min) return PLAN_INFO.enterprise.name;
  return PLAN_ORDER.slice(PLAN_ORDER.indexOf(min)).map((p) => PLAN_INFO[p].name).join(" · ");
}
