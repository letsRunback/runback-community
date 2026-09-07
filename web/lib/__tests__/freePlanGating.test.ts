/**
 * The hosted FREE tier, exercised rather than reasoned about.
 *
 * No QA pass has ever reached a real free-plan session: ensureUserAndOrg gives
 * every signup a 14-day trial, and a trial resolves to `pro`, so every gate an
 * agent could reach was already open. That left the tier every hosted customer
 * eventually lands on — when the trial lapses — verified by code reading only.
 *
 * These run the real entitlement functions and the real fixture helper against
 * plan "free". They do not replace a browser pass over the rendered pages, and
 * that gap is still open; what they close is the part that matters most, which
 * is whether a non-entitled org can end up holding real data.
 */
import { describe, it, expect, vi } from "vitest";
import { can, effectivePlan, minPlanFor } from "@/lib/entitlements";
import { fetchOrFixture } from "@/lib/featureAccess";

// step_replay and ledger were in this list. They moved to the Community
// baseline: LICENSE names deterministic time-travel replay and the signed
// re-executable audit record as Community capabilities, and a self-host
// install resolves to `free` because that licence needs no token — so
// withholding them meant the licence granted rights the code refused.
// licenceGrants.test.ts now asserts the positive direction.
const PAID_FEATURES = [
  "alerting", "rbac", "quality", "approvals", "incidents", "dashboard",
  "policy_library", "policy_simulation", "model_diff", "upgrade_gate",
  "cost_attribution", "drift", "corpus", "model_attribution", "multiagent",
  "topology", "policy_causes", "chargeback", "compliance",
  "regulatory", "sso", "deep_replay",
] as const;

describe("hosted free plan", () => {
  it("grants no paid feature at all", () => {
    for (const f of PAID_FEATURES) {
      // A feature that is on no plan returns null from minPlanFor; skip those
      // rather than asserting on a name this build doesn't know.
      if (minPlanFor(f as never) === null) continue;
      expect(can("free", f as never), `free must not grant ${f}`).toBe(false);
    }
  });

  it("resolves an unknown or missing plan DOWN to free, never up", () => {
    for (const bogus of [null, undefined, "", "enterprise-trial", "platinum"]) {
      expect(effectivePlan(bogus as never)).toBe("free");
    }
  });

  it("is the lowest tier, so nothing can be free-only", () => {
    for (const f of PAID_FEATURES) {
      const min = minPlanFor(f as never);
      if (min === null) continue;
      expect(min, `${f} must not be reachable on free`).not.toBe("free");
    }
  });
});

describe("gated pages cannot hold real data when denied", () => {
  it("never invokes the real fetch for a non-entitled org", async () => {
    // This is the actual leak-prevention mechanism. GateOverlay only BLURS its
    // children with CSS — they are fully present in the HTML — so a page that
    // fetched real data and then rendered it under the gate would ship that
    // org's data to a viewer who is not entitled to it. The guarantee is that
    // the fetch never runs.
    const fetchReal = vi.fn(async () => ["REAL SECRET ROW"]);
    const out = await fetchOrFixture(false, ["fixture"], fetchReal);
    expect(fetchReal).not.toHaveBeenCalled();
    expect(out).toEqual(["fixture"]);
  });

  it("falls back to the fixture when an entitled fetch fails", async () => {
    // A transient DB error must not surface as an empty real view, which reads
    // as "you have no data" rather than "we could not load it".
    const out = await fetchOrFixture(true, ["fixture"], async () => {
      throw new Error("connection reset");
    });
    expect(out).toEqual(["fixture"]);
  });

  it("returns real data when entitled", async () => {
    const out = await fetchOrFixture(true, ["fixture"], async () => ["real"]);
    expect(out).toEqual(["real"]);
  });
});
