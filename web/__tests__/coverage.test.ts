/**
 * Coverage is the number a risk owner reports upward, so the ways it can
 * flatter are the ways it becomes worthless.
 *
 * The denominator is the DECLARED inventory, never the observed one. Measured
 * against what already reports to Runback, coverage is always 100% — a figure
 * that cannot fall and therefore says nothing. And an org that has declared
 * nothing has not achieved full coverage; it has no inventory, which must read
 * as "—" rather than as either 0% or 100%.
 *
 * Undeclared agents sit outside the ratio on purpose: they are a finding, not a
 * denominator adjustment. Counting them in would let discovering shadow AI
 * quietly improve the score.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: { rows: Record<string, unknown>[]; error: { message: string } | null } =
  { rows: [], error: null };

vi.mock("@/lib/adminAudit", () => ({ logAdminAction: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async () => (state.error ? { data: null, error: state.error } : { data: state.rows, error: null }),
  }),
}));

const { agentCoverage } = await import("@/lib/coverage");

const row = (name: string, status: string, criticality = "standard", runs = 0) =>
  ({ name, status, owner: null, criticality, runs, last_seen: null });

beforeEach(() => { state.rows = []; state.error = null; });

describe("coverage summary", () => {
  it("rates coverage against the declared inventory", async () => {
    state.rows = [
      row("a", "covered"), row("b", "covered"), row("c", "covered"),
      row("d", "uninstrumented"),
    ];
    const c = await agentCoverage("org");
    expect(c.declared).toBe(4);
    expect(c.covered).toBe(3);
    expect(c.coverageRate).toBeCloseTo(0.75);
  });

  it("reports no rate when nothing has been declared", async () => {
    // Observed-only. The tempting answers are 100% (everything seen is covered)
    // and 0%; both assert something about an inventory that does not exist.
    state.rows = [row("shadow-1", "undeclared", "standard", 12)];
    const c = await agentCoverage("org");
    expect(c.declared).toBe(0);
    expect(c.coverageRate).toBeNull();
    expect(c.undeclared).toBe(1);
  });

  it("keeps undeclared agents out of the ratio", async () => {
    state.rows = [row("a", "covered"), row("shadow", "undeclared", "standard", 9)];
    const c = await agentCoverage("org");
    // 1 of 1 declared — discovering shadow AI must not move the score.
    expect(c.declared).toBe(1);
    expect(c.coverageRate).toBe(1);
    expect(c.undeclared).toBe(1);
  });

  it("counts a stale agent against coverage", async () => {
    // Declared and instrumented once, now silent: capture broke, or it was
    // retired without anyone saying so. Either way it is not being governed.
    state.rows = [row("a", "covered"), row("b", "stale")];
    const c = await agentCoverage("org");
    expect(c.declared).toBe(2);
    expect(c.coverageRate).toBeCloseTo(0.5);
  });

  it("surfaces silent critical and high-risk agents as gaps", async () => {
    state.rows = [
      row("fraud", "uninstrumented", "critical"),
      row("kyc", "stale", "high"),
      row("newsletter", "uninstrumented", "low"),
      row("support", "covered", "critical"),
    ];
    const c = await agentCoverage("org");
    expect(c.criticalGaps.map((g) => g.name).sort()).toEqual(["fraud", "kyc"]);
  });

  it("surfaces undeclared agents as rows, not just a count, for alerting", async () => {
    state.rows = [row("a", "covered"), row("shadow-1", "undeclared", "standard", 4), row("shadow-2", "undeclared", "standard", 1)];
    const c = await agentCoverage("org");
    expect(c.undeclaredRows.map((r) => r.name).sort()).toEqual(["shadow-1", "shadow-2"]);
  });

  it("throws rather than reporting zero when the query fails", async () => {
    // A failed read must not render as an org with no agents and nothing to do.
    state.error = { message: "relation does not exist" };
    await expect(agentCoverage("org")).rejects.toThrow(/could not compute agent coverage/i);
  });
});
