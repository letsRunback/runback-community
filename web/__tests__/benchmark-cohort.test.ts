import { describe, it, expect } from "vitest";
import { shouldWriteCohort, MIN_COHORT_ORGS } from "../lib/benchmarkCohort";

describe("benchmark cron — k-anonymity cohort floor", () => {
  it("excludes a vertical cohort below the org-count floor (de-anonymization risk)", () => {
    expect(shouldWriteCohort("fintech", 3)).toBe(false);
    expect(shouldWriteCohort("fintech", MIN_COHORT_ORGS - 1)).toBe(false);
  });

  it("includes a vertical cohort once it clears the floor", () => {
    expect(shouldWriteCohort("fintech", MIN_COHORT_ORGS)).toBe(true);
    expect(shouldWriteCohort("healthcare", MIN_COHORT_ORGS + 50)).toBe(true);
  });

  // This case previously asserted the opposite — that 'all' is never excluded,
  // on the assumption that a fleet-wide cohort "is always large enough in
  // practice". The assumption was never checked and was false: production had
  // ONE org in the fleet, so fleet_median equalled the viewer's own value while
  // the report still printed a percentile and a grade. At two or three orgs the
  // median IS another customer's exact figure. The exemption is removed, so the
  // expectation flips.
  it("applies the same floor to the 'all' cohort", () => {
    expect(shouldWriteCohort("all", 0)).toBe(false);
    expect(shouldWriteCohort("all", 1)).toBe(false);
    expect(shouldWriteCohort("all", MIN_COHORT_ORGS - 1)).toBe(false);
    expect(shouldWriteCohort("all", MIN_COHORT_ORGS)).toBe(true);
  });
});
