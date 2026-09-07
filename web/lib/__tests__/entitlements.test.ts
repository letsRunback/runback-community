/**
 * Unit tests for lib/entitlements.ts
 *
 * Covers: effectivePlan, can, trialActive, featurePlan, usageLimits, limits.
 * All tests run in isolation — verifyLicense is mocked to return null (no
 * self-host license) so selfHostEdition() always returns "free", letting us
 * test the org-plan branch cleanly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  effectivePlan,
  can,
  trialActive,
  featurePlan,
  usageLimits,
  limits,
  communityEvalGate,
  PLAN_LIMITS,
  TRIAL_DAYS,
} from "../entitlements";

// No self-host license in tests — isolates org plan branch.
vi.mock("@/lib/license", () => ({ verifyLicense: vi.fn().mockReturnValue(null) }));

const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const past   = () => new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

// ─── effectivePlan ────────────────────────────────────────────────────────────

describe("effectivePlan()", () => {
  it("returns 'free' for null", ()      => expect(effectivePlan(null)).toBe("free"));
  it("returns 'free' for undefined", () => expect(effectivePlan(undefined)).toBe("free"));
  it("returns 'free' for empty string",()=> expect(effectivePlan("")).toBe("free"));
  it("returns 'free' for unknown plan", ()=> expect(effectivePlan("diamond")).toBe("free"));

  it.each(["free","starter","growth","scale","pro","enterprise"] as const)(
    "passes through valid plan '%s'",
    (plan) => expect(effectivePlan(plan)).toBe(plan),
  );
});

// ─── can() ────────────────────────────────────────────────────────────────────

describe("can()", () => {
  describe("free", () => {
    it("has no PAID features", () => {
      expect(can("free", "alerting")).toBe(false);
      expect(can("free", "quality")).toBe(false);
      expect(can("free", "sso")).toBe(false);
    });

    // Renamed from "has no features". Free is no longer empty: the Runback
    // Community Licence names run capture, deterministic time-travel replay
    // and the signed audit record, and a self-host install resolves to `free`
    // because that licence needs no token. Granting nothing meant the licence
    // promised rights the code refused.
    it("HAS the capabilities the Community Licence grants", () => {
      expect(can("free", "step_replay")).toBe(true);
      expect(can("free", "ledger")).toBe(true);
    });
  });

  describe("starter", () => {
    it("has alerting, rbac, approvals", () => {
      expect(can("starter", "alerting")).toBe(true);
      expect(can("starter", "rbac")).toBe(true);
      expect(can("starter", "approvals")).toBe(true);
    });
    it("does NOT have growth+ features", () => {
      expect(can("starter", "quality")).toBe(false);
      expect(can("starter", "incidents")).toBe(false);
      expect(can("starter", "policy_simulation")).toBe(false);
    });
  });

  describe("growth", () => {
    it("adds quality and incidents", () => {
      expect(can("growth", "quality")).toBe(true);
      expect(can("growth", "incidents")).toBe(true);
    });
    it("does NOT have scale+ features", () => {
      expect(can("growth", "policy_simulation")).toBe(false);
      expect(can("growth", "cost_attribution")).toBe(false);
      expect(can("growth", "benchmark")).toBe(false);
    });
  });

  describe("scale", () => {
    it("adds policy_simulation, cost_attribution, topology, model_diff", () => {
      expect(can("scale", "policy_simulation")).toBe(true);
      expect(can("scale", "cost_attribution")).toBe(true);
      expect(can("scale", "topology")).toBe(true);
      expect(can("scale", "model_diff")).toBe(true);
    });
    it("does NOT have pro+ features", () => {
      expect(can("scale", "benchmark")).toBe(false);
      expect(can("scale", "multiagent")).toBe(false);
      // step_replay was asserted absent here. It is now a Community Licence
      // capability on every tier, so scale having it is the fix, not a leak.
    });
    it("does NOT have enterprise-only features", () => {
      expect(can("scale", "sso")).toBe(false);
      expect(can("scale", "chargeback")).toBe(false);
      expect(can("scale", "compliance")).toBe(false);
    });
  });

  describe("pro", () => {
    it("adds corpus, benchmark, trust_chain, step_replay, multiagent", () => {
      expect(can("pro", "corpus")).toBe(true);
      expect(can("pro", "benchmark")).toBe(true);
      expect(can("pro", "trust_chain")).toBe(true);
      expect(can("pro", "step_replay")).toBe(true);
      expect(can("pro", "multiagent")).toBe(true);
    });
    it("does NOT have enterprise-only features", () => {
      expect(can("pro", "sso")).toBe(false);
      expect(can("pro", "chargeback")).toBe(false);
      expect(can("pro", "compliance")).toBe(false);
      expect(can("pro", "regulatory")).toBe(false);
      // `ledger` likewise moved to the Community baseline — see the free block.
    });
  });

  describe("enterprise", () => {
    it("has every feature including sso, chargeback, compliance, regulatory", () => {
      expect(can("enterprise", "sso")).toBe(true);
      expect(can("enterprise", "chargeback")).toBe(true);
      expect(can("enterprise", "compliance")).toBe(true);
      expect(can("enterprise", "regulatory")).toBe(true);
      expect(can("enterprise", "ledger")).toBe(true);
      expect(can("enterprise", "deep_replay")).toBe(true);
    });
  });

  describe("null / unknown input", () => {
    it("null → free → no features", () => expect(can(null, "alerting")).toBe(false));
    it("undefined → free → no features", () => expect(can(undefined, "alerting")).toBe(false));
    it("unknown string → free → no features", () => expect(can("gold", "alerting")).toBe(false));
  });
});

// ─── trialActive() ────────────────────────────────────────────────────────────

describe("trialActive()", () => {
  it("free + future trial_ends_at → active", () =>
    expect(trialActive({ plan: "free", trial_ends_at: future() })).toBe(true));

  it("free + past trial_ends_at → inactive", () =>
    expect(trialActive({ plan: "free", trial_ends_at: past() })).toBe(false));

  it("free + null trial_ends_at → inactive", () =>
    expect(trialActive({ plan: "free", trial_ends_at: null })).toBe(false));

  it("free + no trial_ends_at field → inactive", () =>
    expect(trialActive({ plan: "free" })).toBe(false));

  it("paid plan + future trial_ends_at → inactive (not free plan)", () => {
    expect(trialActive({ plan: "starter", trial_ends_at: future() })).toBe(false);
    expect(trialActive({ plan: "pro",     trial_ends_at: future() })).toBe(false);
  });

  it("null plan + future trial_ends_at → inactive (null → free, but trial_ends_at check is separate from plan)", () => {
    // effectivePlan(null) === "free", so trialActive should be true
    expect(trialActive({ plan: null, trial_ends_at: future() })).toBe(true);
  });
});

// ─── featurePlan() ────────────────────────────────────────────────────────────

describe("featurePlan()", () => {
  it("active trial → 'pro' (unlocks Pro features for evaluation)", () =>
    expect(featurePlan({ plan: "free", trial_ends_at: future() })).toBe("pro"));

  it("expired trial → actual plan ('free')", () =>
    expect(featurePlan({ plan: "free", trial_ends_at: past() })).toBe("free"));

  it("no trial → returns actual plan", () => {
    expect(featurePlan({ plan: "starter" })).toBe("starter");
    expect(featurePlan({ plan: "scale"   })).toBe("scale");
    expect(featurePlan({ plan: "enterprise" })).toBe("enterprise");
  });

  it("paid plan + future trial_ends_at → paid plan (trial only applies to free)", () =>
    expect(featurePlan({ plan: "growth", trial_ends_at: future() })).toBe("growth"));
});

// ─── usageLimits() ────────────────────────────────────────────────────────────

describe("usageLimits()", () => {
  it("active trial → capped trial limits (5000 runs, not 1000)", () => {
    const lim = usageLimits({ plan: "free", trial_ends_at: future() });
    expect(lim.runsPerMonth).toBe(5000);
    expect(lim.retentionDays).toBe(TRIAL_DAYS);
  });

  it("free no trial → free limits (1000 runs/month)", () => {
    const lim = usageLimits({ plan: "free" });
    expect(lim.runsPerMonth).toBe(PLAN_LIMITS.free.runsPerMonth);
  });

  it("enterprise → unlimited", () => {
    const lim = usageLimits({ plan: "enterprise" });
    expect(lim.runsPerMonth).toBe(Infinity);
    expect(lim.retentionDays).toBe(Infinity);
  });
});

// ─── usageLimits() vertical retention floor ──────────────────────────────────

describe("usageLimits() vertical retention floor", () => {
  it("healthcare on free plan (7d) is floored to 180d", () => {
    expect(usageLimits({ plan: "free", vertical: "healthcare" }).retentionDays).toBe(180);
  });

  it("fintech on starter plan (30d) is floored to 90d", () => {
    expect(usageLimits({ plan: "starter", vertical: "fintech" }).retentionDays).toBe(90);
  });

  it("legal on pro plan (90d) is unaffected — plan already meets the 90d floor", () => {
    expect(usageLimits({ plan: "pro", vertical: "legal" }).retentionDays).toBe(90);
  });

  it("fintech on pro plan (90d) already exceeds its 90d floor — unaffected", () => {
    expect(usageLimits({ plan: "pro", vertical: "fintech" }).retentionDays).toBe(90);
  });

  it("general vertical never raises the floor", () => {
    expect(usageLimits({ plan: "free", vertical: "general" }).retentionDays).toBe(PLAN_LIMITS.free.retentionDays);
  });

  it("no vertical set behaves exactly like 'general'", () => {
    expect(usageLimits({ plan: "free" }).retentionDays).toBe(PLAN_LIMITS.free.retentionDays);
  });

  it("unknown vertical string falls back to 'general' (no floor)", () => {
    expect(usageLimits({ plan: "free", vertical: "spacecraft" }).retentionDays).toBe(PLAN_LIMITS.free.retentionDays);
  });

  it("enterprise (Infinity retention) is never lowered by a floor", () => {
    expect(usageLimits({ plan: "enterprise", vertical: "healthcare" }).retentionDays).toBe(Infinity);
  });

  it("active trial (14d) is floored for healthcare to 180d", () => {
    expect(usageLimits({ plan: "free", trial_ends_at: future(), vertical: "healthcare" }).retentionDays).toBe(180);
  });
});

// ─── limits() ────────────────────────────────────────────────────────────────

describe("limits()", () => {
  it("delegates to PLAN_LIMITS via effectivePlan", () => {
    expect(limits("pro").runsPerMonth).toBe(PLAN_LIMITS.pro.runsPerMonth);
    expect(limits("free").seats).toBe(PLAN_LIMITS.free.seats);
  });
});

// ─── communityEvalGate() ──────────────────────────────────────────────────────
// LICENSE-COMMUNITY grants "evals + the release gate" free, with or without
// RUNBACK_LICENSE. This used to be self-host-only; the hosted free tier now
// mirrors the Community edition, so it is unconditional.

describe("communityEvalGate()", () => {
  const originalVercel = process.env.VERCEL;
  beforeEach(() => { delete process.env.VERCEL; });
  afterEach(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("true when self-hosted (no VERCEL env)", () => {
    expect(communityEvalGate()).toBe(true);
  });

  // Previously asserted false here. The hosted free tier deliberately mirrors
  // Community now, so deployment type no longer changes the answer — that is
  // the change, not a regression.
  it("ALSO true on the hosted service — deployment type is not the question", () => {
    process.env.VERCEL = "1";
    expect(communityEvalGate()).toBe(true);
  });

  it("does NOT unlock 'quality' itself — Golden and prompts/pairwise/calibration stay gated", () => {
    // Self-hosted or not, can("free", "quality") is unaffected: the Community
    // grant is checked explicitly at the two eval-gate routes, never folded
    // into can()/PLAN_FEATURES, or Golden would silently unlock alongside it.
    expect(can("free", "quality")).toBe(false);
    expect(communityEvalGate()).toBe(true);
  });
});

/**
 * The plan table must be cumulative.
 *
 * Each tier hand-repeated the one below it, and `can()` reads a single plan's
 * list rather than walking up the order — so adding a feature to a lower tier
 * silently REMOVED it from every higher tier unless all six arrays were edited
 * together. Adding the Community baseline to `free` alone would have made free
 * strictly more capable than Starter, which nothing in the type system or the
 * previous tests would have caught.
 */
describe("plan table is monotonic", () => {
  it("every tier grants everything the tier below it does", () => {
    const order = ["free", "starter", "growth", "scale", "pro", "enterprise"] as const;
    const ALL = [
      "alerting","rbac","quality","approvals","incidents","dashboard","policy_library",
      "policy_simulation","model_diff","upgrade_gate","cost_attribution","drift","corpus",
      "model_attribution","multiagent","topology","policy_causes","chargeback","ledger",
      "compliance","regulatory","sso","deep_replay","step_replay","benchmark",
      "trust_chain","long_retention","proof","guard",
    ] as const;
    const lost: string[] = [];
    for (let i = 1; i < order.length; i++) {
      for (const f of ALL) {
        if (can(order[i - 1], f) && !can(order[i], f)) {
          lost.push(`${order[i]} lost "${f}" that ${order[i - 1]} has`);
        }
      }
    }
    expect(lost, "a higher tier must never grant less than a lower one").toEqual([]);
  });
});
