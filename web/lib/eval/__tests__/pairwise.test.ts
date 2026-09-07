/**
 * comparePairwise()'s self-preference guard (sql/add_pairwise_self_preference_flag.sql):
 * a known LLM-judge bias is grading a comparison where the judge model is the
 * SAME model that produced one of the two candidate outputs. Not blocked —
 * that would mean silently picking a different judge model — but recorded,
 * same "bias-auditing metadata" treatment `randomized` already gets.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { comparePairwise } from "../pairwise";

const state = vi.hoisted(() => ({
  // eval_run_id -> item_id -> output text
  scores: new Map<string, Map<string, string>>(),
  // eval_run_id -> model_id
  runModels: new Map<string, string>(),
  existingVerdicts: new Set<string>(),
  upserts: [] as Record<string, unknown>[],
  itemRequests: new Map<string, unknown>(),
  // Simulates a pre-migration DB: the FIRST upsert attempt (which includes
  // judge_is_candidate) fails; the fallback retry without it must succeed.
  missingJudgeIsCandidateColumn: false,
}));

vi.mock("@/lib/modelKeys", () => ({ getOrgKeys: async () => ({}) }));

vi.mock("../judge", () => ({
  pickJudgeModel: () => "gpt-4o-mini",
  runPairwiseJudge: async () => ({ ok: true, winner: "a", reason: "a is more precise", randomized: false, judgeModel: "gpt-4o-mini" }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "ad_eval_scores") {
        return {
          select: () => ({
            eq: (_col: string, evalRunId: string) => {
              const m = state.scores.get(evalRunId) ?? new Map();
              return Promise.resolve({
                data: [...m.entries()].map(([item_id, text]) => ({ item_id, output: { text } })),
              });
            },
          }),
        };
      }
      if (table === "ad_pairwise_verdicts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({ data: [...state.existingVerdicts].map((item_id) => ({ item_id })) }),
              }),
            }),
          }),
          upsert: (row: Record<string, unknown>) => {
            if (state.missingJudgeIsCandidateColumn && "judge_is_candidate" in row) {
              return Promise.resolve({ error: { message: 'column "judge_is_candidate" of relation "ad_pairwise_verdicts" does not exist' } });
            }
            state.upserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "ad_dataset_items") {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => ({
              data: ids.map((id) => ({ id, request: state.itemRequests.get(id) ?? { messages: [] } })),
            }),
          }),
        };
      }
      if (table === "ad_eval_runs") {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => ({
              data: ids.map((id) => ({ id, model_id: state.runModels.get(id) ?? null })),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

describe("comparePairwise() — self-preference detection", () => {
  beforeEach(() => {
    state.scores = new Map([
      ["run-a", new Map([["item-1", "output A"]])],
      ["run-b", new Map([["item-1", "output B"]])],
    ]);
    state.runModels = new Map();
    state.existingVerdicts = new Set();
    state.upserts = [];
    state.itemRequests = new Map();
    state.missingJudgeIsCandidateColumn = false;
  });

  it("flags judge_is_candidate when the judge model matches side A's model", async () => {
    state.runModels.set("run-a", "gpt-4o-mini"); // same as the mocked judge model
    state.runModels.set("run-b", "claude-haiku-4-5-20251001");
    await comparePairwise("org-1", "run-a", "run-b");
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].judge_is_candidate).toBe(true);
  });

  it("flags judge_is_candidate when the judge model matches side B's model", async () => {
    state.runModels.set("run-a", "claude-haiku-4-5-20251001");
    state.runModels.set("run-b", "gpt-4o-mini");
    await comparePairwise("org-1", "run-a", "run-b");
    expect(state.upserts[0].judge_is_candidate).toBe(true);
  });

  it("does not flag when neither candidate matches the judge model", async () => {
    state.runModels.set("run-a", "claude-haiku-4-5-20251001");
    state.runModels.set("run-b", "claude-opus-4-6");
    await comparePairwise("org-1", "run-a", "run-b");
    expect(state.upserts[0].judge_is_candidate).toBe(false);
  });

  it("never flags in demo mode — no real judge or candidate model is involved", async () => {
    state.runModels.set("run-a", "gpt-4o-mini");
    state.runModels.set("run-b", "gpt-4o-mini");
    await comparePairwise("org-1", "run-a", "run-b", { demo: true });
    expect(state.upserts[0].judge_is_candidate).toBe(false);
  });

  it("falls back to writing the verdict without judge_is_candidate on a pre-migration DB, rather than losing the verdict entirely", async () => {
    state.missingJudgeIsCandidateColumn = true;
    state.runModels.set("run-a", "gpt-4o-mini");
    state.runModels.set("run-b", "claude-haiku-4-5-20251001");
    const result = await comparePairwise("org-1", "run-a", "run-b");
    expect(result.judged).toBe(1);
    expect(result.failed).toBe(0);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]).not.toHaveProperty("judge_is_candidate");
    expect(state.upserts[0].winner).toBe("a");
  });
});
