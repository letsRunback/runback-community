import { describe, it, expect } from "vitest";
import { wouldBlock } from "../policySimCore";
import type { PolicyRule } from "../policy";
import type { LlmEvent } from "@runback/schema";

// A recorded decision step: the agent calls issue_refund for $amount, on a prompt.
const decision = (amount: number, prompt: string, seq = 1): LlmEvent =>
  ({
    schema_version: 1, run_id: "r", span_id: "l", parent_span_id: null, seq,
    ts_start: "t", ts_end: "t", type: "llm",
    model: { provider: "openai", model_id: "gpt-4o" },
    request: { system: null, messages: [{ role: "user", content: prompt }], tools: [], params: {} },
    response: {
      text: null, reasoning: null, finish_reason: "tool-call",
      tool_calls: [{ tool_call_id: "t1", tool_name: "issue_refund", input: { amount } }],
    },
    usage: null, latency_ms: 10, error: null,
  } as unknown as LlmEvent);

// A recorded decision step: the agent calls escalate_to_human, no other tools.
const escalateDecision = (prompt: string, seq: number): LlmEvent =>
  ({
    schema_version: 1, run_id: "r", span_id: "l", parent_span_id: null, seq,
    ts_start: "t", ts_end: "t", type: "llm",
    model: { provider: "openai", model_id: "gpt-4o" },
    request: { system: null, messages: [{ role: "user", content: prompt }], tools: [], params: {} },
    response: {
      text: null, reasoning: null, finish_reason: "tool-call",
      tool_calls: [{ tool_call_id: "t0", tool_name: "escalate_to_human", input: {} }],
    },
    usage: null, latency_ms: 10, error: null,
  } as unknown as LlmEvent);

// "When a refund over $100 is issued on a disputed charge, escalate_to_human must be called."
const refundPolicy: PolicyRule[] = [
  {
    id: "no_unescalated_refund",
    kind: "require",
    when: { op: "and", all: [
      { op: "tool_arg", tool: "issue_refund", path: "amount", cmp: "gt", value: 100 },
      { op: "input_matches", pattern: "disputed", flags: "i" },
    ] },
    then: { op: "tool_called", tool: "escalate_to_human" },
  },
];

describe("policy simulation — wouldBlock", () => {
  it("BLOCKS the recorded $250 refund on a disputed charge (the incident it would have caught)", () => {
    const v = wouldBlock([decision(250, "Customer disputed a $250 charge and wants a refund.")], refundPolicy);
    expect(v.blocked).toBe(true);
    expect(v.detail).toContain("no_unescalated_refund");
  });

  it("ALLOWS a small refund (under the limit — rule is N/A)", () => {
    const v = wouldBlock([decision(40, "Customer disputed a $40 charge.")], refundPolicy);
    expect(v.blocked).toBe(false);
  });

  it("ALLOWS a large refund when the charge is NOT disputed (antecedent doesn't fire)", () => {
    const v = wouldBlock([decision(250, "Please refund $250 for the cancelled order.")], refundPolicy);
    expect(v.blocked).toBe(false);
  });

  it("ALLOWS an escalate-then-refund run spanning two model turns — matches live enforcement's cumulative history, not a per-turn snapshot", () => {
    // The compliant order: escalate_to_human in turn 1, issue_refund in turn 2.
    // Evaluating each decision's own tool_calls in isolation (the old bug) would
    // see turn 2 alone — no escalate_to_human in ITS tool_calls — and falsely
    // block a run that live enforcement, which accumulates tool calls across
    // the whole run, would correctly allow.
    const v = wouldBlock(
      [escalateDecision("Customer disputed a $250 charge.", 1), decision(250, "Customer disputed a $250 charge and wants a refund.", 2)],
      refundPolicy
    );
    expect(v.blocked).toBe(false);
  });

  it("BLOCKS a refund-then-escalate run — escalation came too late to cover the refund pre-hook", () => {
    const v = wouldBlock(
      [decision(250, "Customer disputed a $250 charge and wants a refund.", 1), escalateDecision("Customer disputed a $250 charge.", 2)],
      refundPolicy
    );
    expect(v.blocked).toBe(true);
    expect(v.detail).toContain("no_unescalated_refund");
  });
});
