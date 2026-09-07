import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { median, weightedMean, parseJudgeReply, aggregateJudge, rubricHash, pickJudgeModel, parsePairwiseReply, type JudgeReply } from "../lib/eval/judge";
import type { JudgeCriterion } from "../lib/eval/scorers";

describe("judge — pure aggregation", () => {
  it("median handles odd/even/empty", () => {
    expect(median([0.2, 0.8, 0.5])).toBe(0.5);
    expect(median([0.2, 0.4, 0.6, 0.8])).toBeCloseTo(0.5);
    expect(median([])).toBe(0);
  });

  it("weightedMean weights criteria; falls back to plain mean when all weights are 0", () => {
    const crit: JudgeCriterion[] = [
      { name: "correct", weight: 3 },
      { name: "concise", weight: 1 },
    ];
    // (1.0*3 + 0.0*1) / 4 = 0.75
    expect(weightedMean({ correct: 1, concise: 0 }, crit)).toBeCloseTo(0.75);
    // all-zero weights → plain mean of (1, 0) = 0.5
    expect(weightedMean({ correct: 1, concise: 0 }, [{ name: "correct", weight: 0 }, { name: "concise", weight: 0 }])).toBeCloseTo(0.5);
    // missing criterion score treated as 0
    expect(weightedMean({ correct: 1 }, crit)).toBeCloseTo(0.75);
  });

  it("parseJudgeReply: single rubric score, JSON or loose", () => {
    expect(parseJudgeReply('{"score": 0.8, "reason": "good"}').score).toBeCloseTo(0.8);
    expect(parseJudgeReply("blah blah score: 0.4 trailing").score).toBeCloseTo(0.4);
    expect(parseJudgeReply('{"score": 5}').score).toBe(1); // clamped to 0..1
  });

  it("parseJudgeReply: per-criterion vector (nested scores or flat)", () => {
    const names = ["correct", "concise"];
    const a = parseJudgeReply('{"scores": {"correct": 0.9, "concise": 0.2}, "reason": "x"}', names);
    expect(a.scores).toEqual({ correct: 0.9, concise: 0.2 });
    // tolerate a flat object (no "scores" wrapper)
    const b = parseJudgeReply('{"correct": 1, "concise": 0.5}', names);
    expect(b.scores).toEqual({ correct: 1, concise: 0.5 });
    // missing criterion → 0
    const c = parseJudgeReply('{"scores": {"correct": 0.7}}', names);
    expect(c.scores).toEqual({ correct: 0.7, concise: 0 });
  });

  it("aggregateJudge: single-rubric median across samples vs threshold", () => {
    const replies: JudgeReply[] = [{ score: 0.6, reason: "" }, { score: 0.8, reason: "ok" }, { score: 0.7, reason: "" }];
    const r = aggregateJudge(replies, { threshold: 0.65 });
    expect(r.score).toBeCloseTo(0.7); // median of .6/.7/.8
    expect(r.passed).toBe(true);
  });

  it("aggregateJudge: weighted criteria with per-criterion self-consistency median", () => {
    const crit: JudgeCriterion[] = [{ name: "correct", weight: 3 }, { name: "concise", weight: 1 }];
    // correct medians to 1.0, concise medians to 0.0 → weighted = 0.75
    const replies: JudgeReply[] = [
      { scores: { correct: 1, concise: 0 }, reason: "r1" },
      { scores: { correct: 1, concise: 0.1 }, reason: "" },
      { scores: { correct: 0.9, concise: 0 }, reason: "" },
    ];
    const r = aggregateJudge(replies, { threshold: 0.7, criteria: crit });
    expect(r.score).toBeCloseTo(0.75);
    expect(r.passed).toBe(true);
    expect(r.detail).toContain("correct");
    expect(r.detail).toContain("concise");
  });

  it("aggregateJudge: a low weighted score fails the threshold", () => {
    const crit: JudgeCriterion[] = [{ name: "correct", weight: 3 }, { name: "concise", weight: 1 }];
    const replies: JudgeReply[] = [{ scores: { correct: 0.2, concise: 1 }, reason: "" }];
    const r = aggregateJudge(replies, { threshold: 0.7, criteria: crit });
    expect(r.score).toBeCloseTo(0.4); // (0.2*3 + 1*1)/4
    expect(r.passed).toBe(false);
  });

  it("rubricHash: stable across calls, distinguishes rubric/criteria", () => {
    const h1 = rubricHash("be concise");
    const h2 = rubricHash("be concise");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(rubricHash("be concise", [{ name: "correct" }])).not.toBe(h1);
    expect(rubricHash("be thorough")).not.toBe(h1);
  });

  describe("pickJudgeModel", () => {
    // Ambient env keys (e.g. a real GROQ_API_KEY set in the dev shell) would
    // otherwise leak into these cases via pickJudgeModel's process.env
    // fallback — pin the environment so "no key for provider X" is real.
    const ENV_VARS = ["JUDGE_MODEL", "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
    let saved: Record<string, string | undefined>;
    beforeEach(() => {
      saved = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
      for (const k of ENV_VARS) delete process.env[k];
    });
    afterEach(() => {
      for (const k of ENV_VARS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it("prefers groq > openai > anthropic among available BYOK keys", () => {
      expect(pickJudgeModel({ groq: "gk", openai: "ok", anthropic: "ak" })).toContain("gpt-oss");
      expect(pickJudgeModel({ openai: "ok", anthropic: "ak" })).toBe("gpt-4o-mini");
      expect(pickJudgeModel({ anthropic: "ak" })).toBe("claude-haiku-4-5-20251001");
    });

    it("falls back to a provider's env var when no BYOK key is passed", () => {
      process.env.OPENAI_API_KEY = "env-key";
      expect(pickJudgeModel(undefined)).toBe("gpt-4o-mini");
    });

    it("defaults to groq's model when nothing is configured anywhere", () => {
      expect(pickJudgeModel(undefined)).toContain("gpt-oss");
    });
  });

  describe("parsePairwiseReply", () => {
    it("parses a/b/tie from JSON", () => {
      expect(parsePairwiseReply('{"winner": "a", "reason": "more accurate"}')).toEqual({ winner: "a", reason: "more accurate" });
      expect(parsePairwiseReply('{"winner": "B", "reason": "concise"}').winner).toBe("b"); // case-insensitive
      expect(parsePairwiseReply('{"winner": "tie", "reason": "equivalent"}').winner).toBe("tie");
    });

    it("defaults to tie on garbage or an unrecognized winner value", () => {
      expect(parsePairwiseReply("not json at all").winner).toBe("tie");
      expect(parsePairwiseReply('{"winner": "c", "reason": "?"}').winner).toBe("tie");
    });
  });
});
