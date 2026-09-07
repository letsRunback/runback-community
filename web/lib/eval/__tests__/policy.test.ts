import { describe, it, expect } from "vitest";
import { evaluatePolicy, evalPredicate, inputTextOf, type Policy, type PolicyContext } from "../policy";
import type { ReplayedOutput } from "../scorers";

const ctx = (tool_calls: { tool_name: string; input: unknown }[], text = "", inputText = ""): PolicyContext => ({
  output: { text, finish_reason: "stop", tool_calls, latency_ms: 0, total_tokens: 0, error: null } as ReplayedOutput,
  inputText,
});

// The flagship policy: a disputed-charge refund over $100 must be escalated.
const refundPolicy: Policy = {
  name: "Refund policy", version: 1,
  rules: [
    { id: "escalate-large-disputed", kind: "require", description: "Disputed refunds over $100 escalate",
      when: { op: "and", all: [{ op: "tool_arg", tool: "issue_refund", path: "amount", cmp: "gt", value: 100 }, { op: "input_matches", pattern: "disputed" }] },
      then: { op: "tool_called", tool: "escalate_to_human" } },
    { id: "no-error", kind: "assert", pred: { op: "no_error" } },
  ],
};

describe("policy engine", () => {
  it("FAILS a disputed $250 auto-refund with no escalation (the breach)", () => {
    const r = evaluatePolicy(refundPolicy, ctx([{ tool_name: "issue_refund", input: { amount: 250 } }], "", "a disputed charge of $250"));
    expect(r.passed).toBe(false);
    expect(r.results.find((x) => x.id === "escalate-large-disputed")!.passed).toBe(false);
  });

  it("PASSES when the same case also escalates", () => {
    const r = evaluatePolicy(refundPolicy, ctx([{ tool_name: "issue_refund", input: { amount: 250 } }, { tool_name: "escalate_to_human", input: {} }], "", "a disputed charge of $250"));
    expect(r.passed).toBe(true);
  });

  it("rule is N/A (passes) when the antecedent doesn't fire — $40 refund", () => {
    const r = evaluatePolicy(refundPolicy, ctx([{ tool_name: "issue_refund", input: { amount: 40 } }], "", "customer disputes a $40 charge"));
    expect(r.passed).toBe(true);
    expect(r.results.find((x) => x.id === "escalate-large-disputed")!.applicable).toBe(false);
  });

  it("rule is N/A when over $100 but NOT disputed", () => {
    const r = evaluatePolicy(refundPolicy, ctx([{ tool_name: "issue_refund", input: { amount: 250 } }], "", "routine refund"));
    expect(r.results.find((x) => x.id === "escalate-large-disputed")!.applicable).toBe(false);
    expect(r.passed).toBe(true);
  });

  it("comparators and compound predicates evaluate exactly", () => {
    const c = ctx([{ tool_name: "t", input: { n: 5 } }]);
    expect(evalPredicate({ op: "tool_arg", tool: "t", path: "n", cmp: "gte", value: 5 }, c)).toBe(true);
    expect(evalPredicate({ op: "tool_arg", tool: "t", path: "n", cmp: "gt", value: 5 }, c)).toBe(false);
    expect(evalPredicate({ op: "not", pred: { op: "tool_called", tool: "x" } }, c)).toBe(true);
    expect(evalPredicate({ op: "tool_call_count", cmp: "eq", value: 1 }, c)).toBe(true);
  });

  it("inputTextOf extracts user messages", () => {
    expect(inputTextOf({ messages: [{ role: "user", content: "refund please" }, { role: "assistant", content: "ok" }] })).toContain("refund please");
  });
});
