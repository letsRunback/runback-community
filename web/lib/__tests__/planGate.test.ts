/**
 * Unit tests for lib/planGate.ts — orgHasFeature()
 *
 * Verifies that the DB-backed, trial-aware plan gate returns the correct boolean
 * for every org state that matters in production.  The Supabase admin client is
 * mocked so no real DB is needed; verifyLicense is mocked so no license file is
 * read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { orgHasFeature } from "../planGate";

vi.mock("@/lib/license", () => ({ verifyLicense: vi.fn().mockReturnValue(null) }));

// vi.hoisted() runs before the vi.mock() factory below, so the reference is
// valid when the factory closure captures it.
const mockMaybeSingle = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  }),
}));

const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const past   = () => new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

/** Set what the next DB call returns. */
function orgRow(plan: string, trial_ends_at: string | null = null) {
  mockMaybeSingle.mockResolvedValueOnce({ data: { plan, trial_ends_at } });
}

describe("orgHasFeature()", () => {
  beforeEach(() => { mockMaybeSingle.mockReset(); });

  // ── null / undefined orgId (self-host, license decides) ────────────────────
  it("null orgId + no license → free → blocks paid features", async () => {
    expect(await orgHasFeature(null, "quality")).toBe(false);
    expect(await orgHasFeature(null, "alerting")).toBe(false);
  });

  it("undefined orgId → same as null", async () => {
    expect(await orgHasFeature(undefined, "sso")).toBe(false);
  });

  // ── free plan ───────────────────────────────────────────────────────────────
  it("free plan → no features", async () => {
    orgRow("free");
    expect(await orgHasFeature("org-1", "alerting")).toBe(false);
    orgRow("free");
    expect(await orgHasFeature("org-1", "quality")).toBe(false);
  });

  // ── starter plan ────────────────────────────────────────────────────────────
  it("starter → alerting yes, quality no", async () => {
    orgRow("starter");
    expect(await orgHasFeature("org-1", "alerting")).toBe(true);
    orgRow("starter");
    expect(await orgHasFeature("org-1", "quality")).toBe(false);
  });

  // ── growth plan ─────────────────────────────────────────────────────────────
  it("growth → quality yes, policy_simulation no", async () => {
    orgRow("growth");
    expect(await orgHasFeature("org-1", "quality")).toBe(true);
    orgRow("growth");
    expect(await orgHasFeature("org-1", "policy_simulation")).toBe(false);
  });

  // ── scale plan ──────────────────────────────────────────────────────────────
  it("scale → policy_simulation yes, benchmark no", async () => {
    orgRow("scale");
    expect(await orgHasFeature("org-1", "policy_simulation")).toBe(true);
    orgRow("scale");
    expect(await orgHasFeature("org-1", "benchmark")).toBe(false);
  });

  // ── pro plan ────────────────────────────────────────────────────────────────
  it("pro → benchmark yes, sso no, chargeback no", async () => {
    orgRow("pro");
    expect(await orgHasFeature("org-1", "benchmark")).toBe(true);
    orgRow("pro");
    expect(await orgHasFeature("org-1", "sso")).toBe(false);
    orgRow("pro");
    expect(await orgHasFeature("org-1", "chargeback")).toBe(false);
  });

  // ── enterprise plan ─────────────────────────────────────────────────────────
  it("enterprise → sso yes, chargeback yes, compliance yes", async () => {
    orgRow("enterprise");
    expect(await orgHasFeature("org-1", "sso")).toBe(true);
    orgRow("enterprise");
    expect(await orgHasFeature("org-1", "chargeback")).toBe(true);
    orgRow("enterprise");
    expect(await orgHasFeature("org-1", "compliance")).toBe(true);
  });

  // ── trial — the critical regression case ────────────────────────────────────
  it("active trial (free + future trial_ends_at) → unlocks Pro features", async () => {
    orgRow("free", future());
    expect(await orgHasFeature("org-1", "quality")).toBe(true);
    orgRow("free", future());
    expect(await orgHasFeature("org-1", "benchmark")).toBe(true);
    orgRow("free", future());
    expect(await orgHasFeature("org-1", "trust_chain")).toBe(true);
  });

  it("active trial does NOT unlock Enterprise-only features (sso, chargeback)", async () => {
    orgRow("free", future());
    expect(await orgHasFeature("org-1", "sso")).toBe(false);
    orgRow("free", future());
    expect(await orgHasFeature("org-1", "chargeback")).toBe(false);
  });

  it("expired trial → back to free → blocks paid features", async () => {
    orgRow("free", past());
    expect(await orgHasFeature("org-1", "quality")).toBe(false);
    orgRow("free", past());
    expect(await orgHasFeature("org-1", "benchmark")).toBe(false);
  });

  // ── org not found ────────────────────────────────────────────────────────────
  it("org not found in DB (null data) → treated as free → blocks paid features", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null });
    expect(await orgHasFeature("org-missing", "quality")).toBe(false);
  });
});
