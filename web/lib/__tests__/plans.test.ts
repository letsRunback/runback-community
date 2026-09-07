/**
 * Pricing must have exactly one definition.
 *
 * /pricing and /app/upgrade were independent implementations of the same six
 * tiers, and they had already diverged on substance rather than styling: Pro
 * promised "Quarterly governance review" on the marketing page and "Inter-agent
 * trust chain · signed delegation proofs" in the app, Scale carried a fifth
 * bullet in one and four in the other. Same tier, same price, two different
 * commitments depending on which page a customer read.
 *
 * These tests fail if either surface starts hand-writing prices or features
 * again, and if the plan list stops matching the entitlement order.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PLAN_INFO, PLANS_IN_ORDER } from "@/lib/plans";
import { PLAN_ORDER } from "@/lib/entitlements";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

/**
 * /pricing and /app/upgrade are commercial surfaces and are not part of the
 * Community build, so these assertions have to tolerate their absence there
 * without going quietly vacuous in the real repo. `present()` therefore skips
 * a surface only if it is one of those two AND actually missing; every other
 * surface staying required means a page that vanishes by accident still fails
 * the suite rather than silently dropping out of coverage.
 */
const COMMUNITY_EXCLUDED = new Set(["app/pricing/page.tsx", "app/app/upgrade/page.tsx"]);
const exists = (p: string) => existsSync(join(__dirname, "../..", p));
const present = (files: string[]) => {
  const kept = files.filter((f) => exists(f) || !COMMUNITY_EXCLUDED.has(f));
  // A filter that removed everything would turn `it.each` into zero tests,
  // which reports as a pass. Fail loudly instead.
  if (kept.length === 0) throw new Error("no pricing surfaces found to check");
  return kept;
};

describe("plan catalogue", () => {
  it("covers every plan in the entitlement order, cheapest first", () => {
    expect(PLANS_IN_ORDER.map((p) => p.key)).toEqual(PLAN_ORDER);
  });

  it("derives priceLabel from its parts rather than restating it", () => {
    for (const p of PLANS_IN_ORDER) {
      expect(p.priceLabel).toBe(`${p.priceAmount}${p.pricePeriod ?? ""}`);
    }
  });

  it("gives every tier a tagline and at least three features", () => {
    for (const p of PLANS_IN_ORDER) {
      expect(p.tagline.length, `${p.key} tagline`).toBeGreaterThan(0);
      expect(p.features.length, `${p.key} features`).toBeGreaterThanOrEqual(3);
    }
  });

  it("prices paid tiers monotonically", () => {
    const num = (s: string) => Number(s.replace(/[^0-9.]/g, ""));
    const paid = PLANS_IN_ORDER.filter((p) => p.pricePeriod);
    const amounts = paid.map((p) => num(p.priceAmount));
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });
});

describe("no surface hand-writes pricing", () => {
  const surfaces = [
    "app/pricing/page.tsx",
    "app/app/upgrade/page.tsx",
    "app/get-started/page.tsx",
  ];

  it.each(present(surfaces))("%s contains no hard-coded price", (file) => {
    const src = read(file);
    // Any literal that looks like one of our prices, e.g. $49 / $1,800 / $5,000.
    const literals = [...src.matchAll(/\$\d[\d,]*/g)].map((m) => m[0]);
    expect(literals, `${file} should read prices from PLAN_INFO`).toEqual([]);
  });

  // Both surfaces here are commercial-only, so unlike the check above there is
  // no always-present surface to anchor on: in a Community build the correct
  // result is genuinely "nothing to check". One test that loops internally,
  // rather than it.each, so that case is an explicit assertion about an empty
  // set instead of zero generated tests silently reporting green.
  it("renders tiers from the shared catalogue on every commercial surface", () => {
    const files = ["app/pricing/page.tsx", "app/app/upgrade/page.tsx"].filter(exists);
    for (const file of files) {
      expect(read(file), `${file} should map over PLANS_IN_ORDER`).toMatch(/PLANS_IN_ORDER/);
    }
    // Community drops both. Anything in between means one went missing.
    expect(files.length === 2 || files.length === 0, `unexpected: ${files.join(", ")}`).toBe(true);
  });

  it("does not restate a tier's feature bullets outside lib/plans.ts", () => {
    // A bullet unique enough that finding it in a page means the list was copied.
    const marker = PLAN_INFO.growth.features.find((f) => f.includes("Golden corpus"))!;
    // Commercial-only surfaces again — absent in a Community build, where
    // there is no copied list to find.
    for (const file of ["app/pricing/page.tsx", "app/app/upgrade/page.tsx"].filter(exists)) {
      expect(read(file).includes(marker), `${file} restates a feature bullet`).toBe(false);
    }
  });
});
