/**
 * Industry-vertical vocabulary and compliance-driven retention floors — pure
 * taxonomy, not the classification logic that assigns an org to one. Split
 * out of verticalClassify.ts so core plumbing (entitlements.ts) and every
 * Community-facing consumer (the settings vertical picker, policy library
 * filtering, regulatory reporting labels) can depend on the vocabulary
 * without depending on the inference algorithm those files never needed.
 */

export const VERTICALS = {
  fintech:          { label: "Fintech",          emoji: "💳" },
  healthcare:       { label: "Healthcare",        emoji: "🏥" },
  legal:            { label: "Legal",             emoji: "⚖️"  },
  customer_support: { label: "Customer support",  emoji: "💬" },
  research:         { label: "Research / data",   emoji: "🔬" },
  devops:           { label: "DevOps / infra",    emoji: "⚙️"  },
  general:          { label: "General",           emoji: "◈"  },
} as const;

export type Vertical = keyof typeof VERTICALS;

/**
 * Minimum run-retention days a regulated vertical needs regardless of plan tier —
 * a real floor, not a recommendation. Illustrative of common recordkeeping windows
 * for these industries (e.g. AML/KYC, clinical records); not a certified legal
 * minimum for any specific jurisdiction — confirm against counsel before citing to
 * a customer's auditor. Applied as `max(planRetentionDays, floor)` in
 * `web/lib/entitlements.ts`; 0 = no floor beyond whatever the plan already grants.
 */
export const RETENTION_FLOOR_DAYS: Record<Vertical, number> = {
  fintech:          90,
  healthcare:       180,
  legal:            90,
  customer_support: 0,
  research:         0,
  devops:           0,
  general:          0,
};
