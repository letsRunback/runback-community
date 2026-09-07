/**
 * Unit tests for lib/eval/evalGate.ts — ties an eval's gating_pass_rate to
 * the SAME per-org versioned threshold Models > Gate uses (upgradeGate.ts),
 * with a real database mocked out per table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { gateEvalSuite } from "../evalGate";

interface EvalRow {
  id: string;
  dataset_id: string;
  org_id: string | null;
  status: string;
  total: number;
  gating_total: number | null;
  gating_passed: number | null;
}

interface ScoreRow {
  passed: boolean;
  ad_dataset_items: { source: string | null; approval_status: string | null } | null;
}

const state = vi.hoisted(() => ({
  evalRow: null as EvalRow | null,
  evalError: null as { message: string } | null,
  orgThresholds: { gate_pass_threshold: null as number | null, gate_warn_threshold: null as number | null },
  datasetName: "Adversarial suite",
  scoreRows: [] as { passed: boolean; ad_dataset_items: { source: string | null; approval_status: string | null } | null }[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "ad_eval_runs") return { data: state.evalRow, error: state.evalError };
            if (table === "orgs") return { data: state.orgThresholds };
            if (table === "ad_datasets") return { data: { name: state.datasetName } };
            throw new Error(`unexpected table ${table}`);
          },
          // gateEvalSuite's by_source join awaits the eq() result directly
          // (no .maybeSingle() — it wants every matching row, not one).
          then: (resolve: (v: { data: ScoreRow[]; error: null }) => void) => {
            if (table === "ad_eval_scores") return Promise.resolve({ data: state.scoreRows, error: null }).then(resolve);
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        }),
      }),
    }),
  }),
}));

function setEval(row: Partial<EvalRow>) {
  state.evalRow = {
    id: "eval-1",
    dataset_id: "ds-1",
    org_id: "org-1",
    status: "done",
    total: 10,
    gating_total: 10,
    gating_passed: 10,
    ...row,
  };
  state.evalError = null;
}

describe("gateEvalSuite()", () => {
  beforeEach(() => {
    state.evalRow = null;
    state.evalError = null;
    state.orgThresholds = { gate_pass_threshold: null, gate_warn_threshold: null };
    state.datasetName = "Adversarial suite";
    state.scoreRows = [];
  });

  it("returns null when the eval doesn't exist", async () => {
    state.evalError = { message: "not found" };
    expect(await gateEvalSuite("org-1", "eval-1")).toBeNull();
  });

  it("returns null when the eval belongs to a different org", async () => {
    setEval({ org_id: "org-2" });
    expect(await gateEvalSuite("org-1", "eval-1")).toBeNull();
  });

  it("returns null when the eval hasn't finished", async () => {
    setEval({ status: "running" });
    expect(await gateEvalSuite("org-1", "eval-1")).toBeNull();
  });

  it("returns null on a pre-migration DB (gating_total/gating_passed absent)", async () => {
    setEval({ gating_total: null, gating_passed: null });
    expect(await gateEvalSuite("org-1", "eval-1")).toBeNull();
  });

  it("pass: gating_pass_rate at/above the default 0.95 threshold", async () => {
    setEval({ total: 20, gating_total: 20, gating_passed: 19 }); // 0.95
    const report = await gateEvalSuite("org-1", "eval-1");
    expect(report?.verdict).toBe("pass");
    expect(report?.pass_rate).toBeCloseTo(0.95);
    expect(report?.pass_threshold).toBe(0.95);
  });

  it("warning: gating_pass_rate between warn (0.80) and pass (0.95)", async () => {
    setEval({ total: 10, gating_total: 10, gating_passed: 8 }); // 0.80
    const report = await gateEvalSuite("org-1", "eval-1");
    expect(report?.verdict).toBe("warning");
  });

  it("fail: gating_pass_rate below the warn threshold", async () => {
    setEval({ total: 10, gating_total: 10, gating_passed: 5 }); // 0.50
    const report = await gateEvalSuite("org-1", "eval-1");
    expect(report?.verdict).toBe("fail");
  });

  it("no_data: gating_total is legitimately zero (every item still pending/rejected)", async () => {
    setEval({ total: 5, gating_total: 0, gating_passed: 0 });
    const report = await gateEvalSuite("org-1", "eval-1");
    expect(report?.verdict).toBe("no_data");
    expect(report?.excluded_from_gating).toBe(5);
  });

  it("respects the org's OWN versioned threshold, not the 0.95/0.80 default", async () => {
    state.orgThresholds = { gate_pass_threshold: 0.6, gate_warn_threshold: 0.4 };
    setEval({ total: 10, gating_total: 10, gating_passed: 7 }); // 0.70 — fails default 0.95, passes org's 0.6
    const report = await gateEvalSuite("org-1", "eval-1");
    expect(report?.verdict).toBe("pass");
    expect(report?.pass_threshold).toBe(0.6);
  });

  it("excluded_from_gating reflects items scored but not counted (pending/rejected synthetic)", async () => {
    setEval({ total: 12, gating_total: 9, gating_passed: 9 });
    const report = await gateEvalSuite("org-1", "eval-1");
    expect(report?.excluded_from_gating).toBe(3);
    expect(report?.verdict).toBe("pass");
  });

  it("carries the dataset name through", async () => {
    state.datasetName = "Red-team suite v2";
    setEval({});
    const report = await gateEvalSuite("org-1", "eval-1");
    expect(report?.dataset_name).toBe("Red-team suite v2");
  });

  describe("by_source — the aggregate pass_rate can't say where a regression is concentrated", () => {
    it("splits captured vs. synthetic-approved pass/fail counts", async () => {
      setEval({ total: 4, gating_total: 4, gating_passed: 2 });
      state.scoreRows = [
        { passed: true, ad_dataset_items: { source: "captured", approval_status: null } },
        { passed: true, ad_dataset_items: { source: "captured", approval_status: null } },
        { passed: false, ad_dataset_items: { source: "synthetic", approval_status: "approved" } },
        { passed: false, ad_dataset_items: { source: "synthetic", approval_status: "approved" } },
      ];
      const report = await gateEvalSuite("org-1", "eval-1");
      expect(report?.by_source).toEqual({
        captured: { total: 2, passed: 2 },
        synthetic_approved: { total: 2, passed: 0 },
      });
    });

    it("excludes pending/rejected synthetic items from the breakdown, same as the aggregate", async () => {
      setEval({ total: 3, gating_total: 1, gating_passed: 1 });
      state.scoreRows = [
        { passed: true, ad_dataset_items: { source: "captured", approval_status: null } },
        { passed: false, ad_dataset_items: { source: "synthetic", approval_status: "pending" } },
        { passed: false, ad_dataset_items: { source: "synthetic", approval_status: "rejected" } },
      ];
      const report = await gateEvalSuite("org-1", "eval-1");
      expect(report?.by_source).toEqual({
        captured: { total: 1, passed: 1 },
        synthetic_approved: { total: 0, passed: 0 },
      });
    });

    it("never fails the report itself — an empty score join still yields a valid (all-zero) breakdown", async () => {
      setEval({ total: 5, gating_total: 5, gating_passed: 5 });
      state.scoreRows = [];
      const report = await gateEvalSuite("org-1", "eval-1");
      expect(report?.verdict).toBe("pass"); // unaffected
      expect(report?.by_source).toEqual({ captured: { total: 0, passed: 0 }, synthetic_approved: { total: 0, passed: 0 } });
    });
  });
});
