import { describe, it, expect } from "vitest";
import { detectBad, computeStreak, suggestRule, needsReReview, STALE_REVIEW_DAYS, type GoldenRunHistoryRow, type BadSignature } from "../goldenCore";
import type { TraceEvent } from "@runback/schema";

const blockedTool = (rule: string, input: unknown): TraceEvent =>
  ({
    schema_version: 1, run_id: "r", span_id: "t", parent_span_id: null, seq: 1,
    ts_start: "t", ts_end: "t", type: "tool",
    tool_name: "issue_refund", tool_call_id: "1", input, output: null, latency_ms: 0,
    error: { name: "PolicyBlock", message: "blocked" },
    policy_block: { rule, detail: "violated" },
  } as unknown as TraceEvent);

const erroredTool = (name: string): TraceEvent =>
  ({
    schema_version: 1, run_id: "r", span_id: "t", parent_span_id: null, seq: 1,
    ts_start: "t", ts_end: "t", type: "tool",
    tool_name: name, tool_call_id: "1", input: { x: 1 }, output: null, latency_ms: 0,
    error: { name: "TimeoutError", message: "timed out" },
  } as unknown as TraceEvent);

const okTool: TraceEvent = {
  schema_version: 1, run_id: "r", span_id: "t", parent_span_id: null, seq: 1,
  ts_start: "t", ts_end: "t", type: "tool",
  tool_name: "lookup", tool_call_id: "1", input: {}, output: { ok: true }, latency_ms: 1, error: null,
} as unknown as TraceEvent;

describe("detectBad — golden enrollment + dedup signature", () => {
  it("flags a policy-blocked run (priority over plain errors)", () => {
    const b = detectBad("refund-agent", [blockedTool("escalate-large-disputed", { amount: 250 })]);
    expect(b?.reason).toBe("policy_block");
    expect(b?.detail).toContain("escalate-large-disputed");
  });

  it("flags an errored run", () => {
    const b = detectBad("kyc-agent", [erroredTool("verify_abn")]);
    expect(b?.reason).toBe("error");
  });

  it("ignores a clean run", () => {
    expect(detectBad("ok-agent", [okTool])).toBeNull();
  });

  it("DEDUPES: the same failing decision yields the same signature", () => {
    const a = detectBad("refund-agent", [blockedTool("escalate-large-disputed", { amount: 250 })]);
    const b = detectBad("refund-agent", [blockedTool("escalate-large-disputed", { amount: 250 })]);
    expect(a?.signature).toBe(b?.signature); // → one golden test, not two
  });

  it("DISTINGUISHES different failure modes (different signatures)", () => {
    const a = detectBad("refund-agent", [blockedTool("escalate-large-disputed", { amount: 250 })]);
    const b = detectBad("refund-agent", [blockedTool("escalate-large-disputed", { amount: 900 })]);
    const c = detectBad("refund-agent", [blockedTool("no-refund-weekend", { amount: 250 })]);
    expect(a?.signature).not.toBe(b?.signature); // different input
    expect(a?.signature).not.toBe(c?.signature); // different rule
  });
});

const h = (result: string, policy_digest: string | null = "p1"): GoldenRunHistoryRow => ({ result, policy_digest });

describe("computeStreak — the run history a data export can't reconstruct", () => {
  it("counts consecutive good results, newest first", () => {
    expect(computeStreak([h("reproduced"), h("reproduced"), h("changed")]).runs).toBe(3);
  });

  it("stops counting at the most recent bad result", () => {
    const rows = [h("reproduced"), h("reproduced"), h("diverged"), h("reproduced"), h("reproduced")];
    expect(computeStreak(rows).runs).toBe(2); // only the two newest, before hitting "diverged"
  });

  it("a missing run also breaks the streak, same as a bad result", () => {
    expect(computeStreak([h("reproduced"), h("missing"), h("reproduced")]).runs).toBe(1);
  });

  it("counts distinct policy revisions survived, not total runs", () => {
    const rows = [h("reproduced", "p3"), h("reproduced", "p3"), h("reproduced", "p2"), h("reproduced", "p1")];
    const streak = computeStreak(rows);
    expect(streak.runs).toBe(4);
    expect(streak.policyRevisions).toBe(3); // p3 counted once despite appearing twice
  });

  it("a run with no policy_digest contributes to the streak but not the revision count", () => {
    const streak = computeStreak([h("reproduced", null), h("reproduced", null)]);
    expect(streak.runs).toBe(2);
    expect(streak.policyRevisions).toBe(0);
  });

  it("an empty history is a zero streak, not an error", () => {
    expect(computeStreak([])).toEqual({ runs: 0, policyRevisions: 0 });
  });

  it("an unrecognised result is skipped without breaking the streak (forward-compatible with new result types)", () => {
    expect(computeStreak([h("reproduced"), h("some-future-result"), h("reproduced")]).runs).toBe(2);
  });
});

describe("detectBad populates tool_name for an error incident", () => {
  it("carries the failing tool's name through, for suggestRule() to use later", () => {
    const bad = detectBad("kyc-agent", [erroredTool("verify_abn")]);
    expect(bad?.tool_name).toBe("verify_abn");
  });

  it("leaves tool_name undefined for a policy_block incident (suggestRule() must not fire for it)", () => {
    const bad = detectBad("refund-agent", [blockedTool("escalate-large-disputed", { amount: 250 })]);
    expect(bad?.tool_name).toBeUndefined();
  });
});

describe("suggestRule — drafting a rule from an uncovered incident", () => {
  const errorBad: BadSignature = { reason: "error", signature: "abcdef1234567890", detail: "kyc-agent — verify_abn threw TimeoutError", tool_name: "verify_abn" };

  it("returns null for a policy_block incident — it's already covered, nothing to suggest", () => {
    const bad: BadSignature = { reason: "policy_block", signature: "sig1", detail: "issue_refund blocked — escalate-large-disputed" };
    expect(suggestRule(bad)).toBeNull();
  });

  it("returns null for a run-level error with no specific tool — the DSL can't express it", () => {
    const bad: BadSignature = { reason: "error", signature: "sig2", detail: "kyc-agent failed — ConfigError" };
    expect(suggestRule(bad)).toBeNull();
  });

  it("drafts an assert rule that blocks the failing tool, for a tool-specific error", () => {
    const suggestion = suggestRule(errorBad);
    expect(suggestion).not.toBeNull();
    const rule = suggestion!.rule;
    expect(rule.kind).toBe("assert");
    if (rule.kind === "assert") {
      expect(rule.pred).toEqual({ op: "not", pred: { op: "tool_called", tool: "verify_abn" } });
    }
  });

  it("the note is explicit that the draft is unconditional, not scoped to the actual failure", () => {
    const suggestion = suggestRule(errorBad);
    expect(suggestion?.note).toMatch(/every call/i);
    expect(suggestion?.note).toContain("verify_abn");
  });

  it("the rule id is derived from the incident signature, so it's traceable back to the incident that seeded it", () => {
    const suggestion = suggestRule(errorBad);
    expect(suggestion?.rule.id).toBe(`auto-${errorBad.signature.slice(0, 10)}`);
  });
});

describe("needsReReview — reproducing a cassette isn't the same as the recorded behavior still being correct", () => {
  const NOW = new Date("2026-06-01T00:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString();

  it("never flags an active (never-approved) entry — that's a first-review gap, not a staleness one", () => {
    expect(needsReReview({ status: "active", approved_at: null, created_at: daysAgo(400) }, NOW)).toBe(false);
  });

  it("never flags a dismissed entry", () => {
    expect(needsReReview({ status: "dismissed", approved_at: daysAgo(400), created_at: daysAgo(400) }, NOW)).toBe(false);
  });

  it("does not flag a recently-approved entry", () => {
    expect(needsReReview({ status: "approved", approved_at: daysAgo(10), created_at: daysAgo(10) }, NOW)).toBe(false);
  });

  it(`flags an approved entry older than ${STALE_REVIEW_DAYS} days since approval`, () => {
    expect(needsReReview({ status: "approved", approved_at: daysAgo(STALE_REVIEW_DAYS + 1), created_at: daysAgo(STALE_REVIEW_DAYS + 1) }, NOW)).toBe(true);
  });

  it("is not yet flagged exactly at the threshold, only once it's exceeded", () => {
    expect(needsReReview({ status: "approved", approved_at: daysAgo(STALE_REVIEW_DAYS), created_at: daysAgo(STALE_REVIEW_DAYS) }, NOW)).toBe(false);
  });

  it("falls back to created_at when approved_at is missing (a legacy row from before that column existed)", () => {
    expect(needsReReview({ status: "approved", approved_at: null, created_at: daysAgo(STALE_REVIEW_DAYS + 1) }, NOW)).toBe(true);
    expect(needsReReview({ status: "approved", approved_at: null, created_at: daysAgo(1) }, NOW)).toBe(false);
  });
});
