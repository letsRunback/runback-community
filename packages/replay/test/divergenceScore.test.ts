import { describe, it, expect } from "vitest";
import { scoreDivergence } from "../src/divergenceScore";
import type { ModelDecision } from "../src/enterprise/runReplay";

const decision = (over: Partial<ModelDecision> = {}): ModelDecision => ({
  tool_calls: [],
  finish_reason: "stop",
  text: null,
  ...over,
});

describe("scoreDivergence", () => {
  it("scores identical decisions as equivalent with near-zero severity", () => {
    const a = decision({ tool_calls: [{ tool_name: "escalate_to_human", input: { reason: "disputed" } }] });
    const b = decision({ tool_calls: [{ tool_name: "escalate_to_human", input: { reason: "disputed" } }] });
    const s = scoreDivergence(a, b);
    expect(s.category).toBe("equivalent");
    expect(s.severity).toBeLessThan(10);
  });

  it("scores acting-vs-answering as the highest severity — the biggest practical behavior change", () => {
    const acted = decision({ tool_calls: [{ tool_name: "issue_refund", input: { amount: 250 } }] });
    const answered = decision({ text: "I can't process that automatically.", finish_reason: "stop" });
    const s = scoreDivergence(acted, answered);
    expect(s.category).toBe("tool_changed");
    expect(s.severity).toBeGreaterThanOrEqual(90);
  });

  it("scores a different tool entirely as high severity", () => {
    const a = decision({ tool_calls: [{ tool_name: "escalate_to_human", input: {} }] });
    const b = decision({ tool_calls: [{ tool_name: "issue_refund", input: { amount: 250 } }] });
    const s = scoreDivergence(a, b);
    expect(s.category).toBe("tool_changed");
    expect(s.severity).toBeGreaterThanOrEqual(85);
  });

  it("scales severity with the size of a numeric argument change on the same tool", () => {
    const small = scoreDivergence(
      decision({ tool_calls: [{ tool_name: "issue_refund", input: { amount: 100 } }] }),
      decision({ tool_calls: [{ tool_name: "issue_refund", input: { amount: 101 } }] })
    );
    const large = scoreDivergence(
      decision({ tool_calls: [{ tool_name: "issue_refund", input: { amount: 100 } }] }),
      decision({ tool_calls: [{ tool_name: "issue_refund", input: { amount: 900 } }] })
    );
    expect(small.category).toBe("args_changed");
    expect(large.category).toBe("args_changed");
    expect(large.severity).toBeGreaterThan(small.severity);
  });

  it("treats a near-identical text response (whitespace/minor wording) as equivalent, not text_changed", () => {
    const a = decision({ text: "Your refund has been approved." });
    const b = decision({ text: "Your refund has  been approved!" });
    const s = scoreDivergence(a, b);
    expect(s.category).toBe("equivalent");
    expect(s.severity).toBeLessThan(20);
  });

  it("is honest about its own limit: a real paraphrase with heavier edits reads as text_changed, not equivalent — this is surface similarity, not semantic judgment", () => {
    const a = decision({ text: "Your refund has been approved and will arrive in 3-5 business days." });
    const b = decision({ text: "Your refund is approved and should arrive within 3-5 business days." });
    const s = scoreDivergence(a, b);
    // Character-level edit distance, not an embedding/judge model — a
    // genuine paraphrase with several word substitutions crosses the
    // similarity threshold even though a human would call these the same
    // answer. Catching that needs a semantic comparison this module
    // deliberately doesn't do (see file docstring); asserting the real
    // behavior here so a future change to the threshold has to notice it
    // shifted this case, not silently improve or regress it.
    expect(s.category).toBe("text_changed");
  });

  it("flags a materially different text response", () => {
    const a = decision({ text: "Your refund has been approved." });
    const b = decision({ text: "I'm unable to help with that request. Please contact support." });
    const s = scoreDivergence(a, b);
    expect(s.category).toBe("text_changed");
    expect(s.severity).toBeGreaterThan(40);
  });

  it("is symmetric on category for genuinely equivalent same-tool same-args calls regardless of key order", () => {
    const a = decision({ tool_calls: [{ tool_name: "issue_refund", input: { amount: 100, reason: "goodwill" } }] });
    const b = decision({ tool_calls: [{ tool_name: "issue_refund", input: { reason: "goodwill", amount: 100 } }] });
    const s = scoreDivergence(a, b);
    expect(s.category).toBe("equivalent");
  });

  it("regression: catches a drastic argument change on a reordered tool call — pairs by name, not array position", () => {
    // Same tool set (charge_card, log_event) on both sides, but the order
    // flipped AND charge_card's amount changed by 9999x. Index-pairing used
    // to compare log_event(a[0]) against charge_card(b[0]) — mismatched
    // names, silently skipped — and charge_card(a[1]) against nothing,
    // producing a false "equivalent, severity 5". Pairing by name catches it.
    const a = decision({
      tool_calls: [
        { tool_name: "charge_card", input: { amount: 1 } },
        { tool_name: "log_event", input: { msg: "ok" } },
      ],
    });
    const b = decision({
      tool_calls: [
        { tool_name: "log_event", input: { msg: "ok" } },
        { tool_name: "charge_card", input: { amount: 9999 } },
      ],
    });
    const s = scoreDivergence(a, b);
    expect(s.category).toBe("args_changed");
    expect(s.severity).toBeGreaterThan(50);
    expect(s.reason).toContain("charge_card");
  });

  it("pairs duplicate same-name calls in each side's own order, not cross-matched", () => {
    const a = decision({
      tool_calls: [
        { tool_name: "log_event", input: { msg: "first" } },
        { tool_name: "log_event", input: { msg: "second" } },
      ],
    });
    const b = decision({
      tool_calls: [
        { tool_name: "log_event", input: { msg: "first" } },
        { tool_name: "log_event", input: { msg: "second" } },
      ],
    });
    const s = scoreDivergence(a, b);
    expect(s.category).toBe("equivalent");
  });
});
