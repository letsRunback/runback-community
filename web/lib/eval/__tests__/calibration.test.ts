/**
 * getFewShotExamples' judge-model drift guard (sql/add_judge_model.sql): a
 * silent provider checkpoint swap, or an org switching BYOK providers, must
 * not keep feeding the new judge corrections gathered under a DIFFERENT
 * judge's behavior with nothing surfacing that it happened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFewShotExamples } from "../calibration";

interface ReviewRow {
  output_snippet: string | null;
  judge_passed: boolean;
  human_passed: boolean;
  human_note: string | null;
  reviewed_at: string;
  judge_model: string | null;
}

const state = vi.hoisted(() => ({ rows: [] as ReviewRow[] }));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({
                limit: async () => ({ data: state.rows }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

function row(overrides: Partial<ReviewRow>): ReviewRow {
  return {
    output_snippet: "some output",
    judge_passed: true,
    human_passed: false, // a correction by default
    human_note: null,
    reviewed_at: new Date().toISOString(),
    judge_model: null,
    ...overrides,
  };
}

describe("getFewShotExamples() — judge-model drift guard", () => {
  beforeEach(() => {
    state.rows = [];
  });

  it("includes a correction recorded under the SAME judge model", async () => {
    state.rows = [row({ judge_model: "gpt-4o-mini" })];
    const out = await getFewShotExamples("org-1", "hash-1", 3, "gpt-4o-mini");
    expect(out).toHaveLength(1);
  });

  it("excludes a correction recorded under a DIFFERENT judge model — the drift case", async () => {
    state.rows = [row({ judge_model: "gpt-4o-mini" })];
    const out = await getFewShotExamples("org-1", "hash-1", 3, "claude-haiku-4-5-20251001");
    expect(out).toHaveLength(0);
  });

  it("includes a pre-migration row with no judge_model recorded — unknown, not a proven mismatch", async () => {
    state.rows = [row({ judge_model: null })];
    const out = await getFewShotExamples("org-1", "hash-1", 3, "gpt-4o-mini");
    expect(out).toHaveLength(1);
  });

  it("applies no filtering at all when the caller doesn't know the current judge model", async () => {
    state.rows = [row({ judge_model: "some-other-model" })];
    const out = await getFewShotExamples("org-1", "hash-1", 3, undefined);
    expect(out).toHaveLength(1);
  });

  it("a mixed batch keeps only same-model and unknown-model corrections", async () => {
    state.rows = [
      row({ judge_model: "gpt-4o-mini", output_snippet: "same-model" }),
      row({ judge_model: "claude-haiku-4-5-20251001", output_snippet: "different-model" }),
      row({ judge_model: null, output_snippet: "unknown-model" }),
    ];
    const out = await getFewShotExamples("org-1", "hash-1", 10, "gpt-4o-mini");
    expect(out.map((e) => e.output).sort()).toEqual(["same-model", "unknown-model"].sort());
  });

  it("still excludes agreements (judge_passed === human_passed) regardless of judge model", async () => {
    state.rows = [row({ judge_model: "gpt-4o-mini", judge_passed: true, human_passed: true })];
    const out = await getFewShotExamples("org-1", "hash-1", 3, "gpt-4o-mini");
    expect(out).toHaveLength(0);
  });
});
