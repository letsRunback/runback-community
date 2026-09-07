/**
 * verified_cost_usd prices every run a counterfactual replay actually
 * verified — it feeds verified_pct and cost_per_verified_run on the Cost
 * page's "Verified via replay" KPI.
 *
 * The ad_events lookup used to filter with a single `.in("run_id", ids)`
 * sliced to the first 500 ids, exactly like the read-truncation bug class
 * lib/supabase/read.ts's readAll() exists to prevent elsewhere in this
 * codebase (see its header comment). An org with more than 500 verified
 * runs in the window got a verified_cost_usd priced from a fraction of what
 * was actually verified, with nothing marking the number as partial. This
 * pins that more than 500 verified runs are all priced, not just the first
 * chunk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  gates: { results: { run_id: string; passed: boolean }[] }[];
  events: { run_id: string; model_id: string; total_tokens: number }[];
} = { gates: [], events: [] };

vi.mock("@/lib/costAttr", async () => {
  const actual = await vi.importActual<typeof import("@/lib/costAttr")>("@/lib/costAttr");
  return {
    ...actual,
    getCostAttribution: async () => ({
      window_days: 30, total_cost_usd: 1000, total_tokens: 1_000_000, total_runs: 2000,
      by_model: [], by_agent: [], optimizations: [], generated_at: new Date().toISOString(),
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => {
  const builder = (table: string) => {
    const inLists: string[][] = [];
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.gte = self;
    api.not = self;
    api.limit = self;
    api.in = (_col: string, vals: string[]) => { inLists.push(vals); return api; };

    const result = () => {
      if (table === "ad_upgrade_gates") return { data: state.gates, error: null };
      if (table === "ad_events") {
        // Mirror PostgREST: only events whose run_id is in THIS call's IN list.
        const ids = new Set(inLists[inLists.length - 1] ?? []);
        return { data: state.events.filter((e) => ids.has(e.run_id)), error: null };
      }
      return { data: [], error: null };
    };
    api.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(res, rej);
    return api;
  };
  return { getAdminClient: () => ({ from: (t: string) => builder(t) }) };
});

const { getVerifiedReplayCost } = await import("@/lib/verifiedCost");

beforeEach(() => { state.gates = []; state.events = []; });

describe("verified replay cost — IN-list chunking", () => {
  it("prices every verified run, not just the first 500", async () => {
    const N = 650;
    const runIds = Array.from({ length: N }, (_, i) => `run-${i}`);
    state.gates = [{ results: runIds.map((run_id) => ({ run_id, passed: true })) }];
    // 1000 tokens each on a model with a known blended rate.
    state.events = runIds.map((run_id) => ({ run_id, model_id: "gpt-4o-mini", total_tokens: 1_000_000 }));

    const report = await getVerifiedReplayCost("org-a", 30);
    expect(report.verified_runs).toBe(N);
    // Every run's event must be priced — not just the first chunk of 500.
    // gpt-4o-mini: 0.6*0.15 + 0.4*0.60 = $0.33 per 1M tokens, per run at 1M tokens.
    expect(report.verified_cost_usd).toBeCloseTo(N * 0.33, 1);
  });

  it("still handles fewer than 500 verified runs (the common case)", async () => {
    const runIds = ["a", "b", "c"];
    state.gates = [{ results: runIds.map((run_id) => ({ run_id, passed: true })) }];
    state.events = runIds.map((run_id) => ({ run_id, model_id: "gpt-4o-mini", total_tokens: 1_000_000 }));
    const report = await getVerifiedReplayCost("org-a", 30);
    expect(report.verified_runs).toBe(3);
    expect(report.verified_cost_usd).toBeCloseTo(3 * 0.33, 1);
  });
});
