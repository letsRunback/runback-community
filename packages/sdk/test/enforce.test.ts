import { describe, it, expect } from "vitest";
import { Collector } from "../src/collector";
import type { PolicyRule } from "@runback/policy";

const rules: PolicyRule[] = [
  {
    id: "escalate-large-disputed",
    kind: "require",
    when: { op: "and", all: [
      { op: "tool_arg", tool: "issue_refund", path: "amount", cmp: "gt", value: 100 },
      { op: "input_matches", pattern: "disputed", flags: "i" },
    ] },
    then: { op: "tool_called", tool: "escalate_to_human" },
  },
];

describe("Collector runtime enforcement (SDK pre-hook)", () => {
  it("blocks the disputed $250 refund and records a re-runnable block event", () => {
    const c = new Collector({ runName: "t", input: "Customer #8842 disputed a $250 charge.", enforce: rules });
    const before = c.cassetteDigest();

    expect(c.enforceToolCall("lookup_customer", { id: 8842 }).allowed).toBe(true);
    const refund = c.enforceToolCall("issue_refund", { amount: 250 });

    expect(refund.allowed).toBe(false);
    expect(refund.rule).toBe("escalate-large-disputed");
    // The block was recorded as an event (the oracle chain advanced — proof on the ledger).
    const after = c.cassetteDigest();
    expect(after.entry_count).toBeGreaterThan(before.entry_count);
    expect(after.digest).not.toBe(before.digest);
  });

  it("allows the refund once escalate_to_human has run first (the agent's recovery path)", () => {
    const c = new Collector({ runName: "t", input: "Customer #8842 disputed a $250 charge.", enforce: rules });
    c.enforceToolCall("lookup_customer", { id: 8842 });
    c.enforceToolCall("escalate_to_human", { reason: "disputed" });
    expect(c.enforceToolCall("issue_refund", { amount: 250 }).allowed).toBe(true);
  });

  it("does nothing when no enforcement rules are configured", () => {
    const c = new Collector({ runName: "t", input: "anything" });
    expect(c.enforceToolCall("issue_refund", { amount: 9999 }).allowed).toBe(true);
  });
});

describe("Collector runtime enforcement — failClosed vs the default fail-open", () => {
  // A malformed rule that makes the policy engine itself throw when
  // evaluated (not "denied" — the check machinery breaks: evalPredicate's
  // "and" case does `p.all.every(...)` with no null-check), to exercise the
  // catch path in enforceToolCall.
  const brokenRule = [
    { id: "broken", kind: "assert", pred: { op: "and" } },
  ] as unknown as PolicyRule[];

  it("default (failClosed unset): a broken policy fails OPEN — the action is allowed", () => {
    const c = new Collector({ runName: "t", enforce: brokenRule });
    const decision = c.enforceToolCall("issue_refund", { amount: 9999 });
    expect(decision.allowed).toBe(true);
    expect(decision.evaluated).toBe(false);
  });

  it("failClosed: true — a broken policy fails CLOSED — the action is blocked and recorded", () => {
    const c = new Collector({ runName: "t", enforce: brokenRule, failClosed: true });
    const before = c.cassetteDigest();
    const decision = c.enforceToolCall("issue_refund", { amount: 9999 });
    expect(decision.allowed).toBe(false);
    expect(decision.rule).toBe("enforcement_error");
    expect(decision.detail).toContain("policy evaluation threw");
    // Still recorded as a first-class, hash-chained block event — same
    // audit-trail guarantee as a real policy denial.
    const after = c.cassetteDigest();
    expect(after.entry_count).toBeGreaterThan(before.entry_count);
  });

  it("failClosed: true with a WORKING policy behaves exactly like the default — only the error path changes", () => {
    const c = new Collector({ runName: "t", input: "Customer #8842 disputed a $250 charge.", enforce: rules, failClosed: true });
    expect(c.enforceToolCall("lookup_customer", { id: 8842 }).allowed).toBe(true);
    const refund = c.enforceToolCall("issue_refund", { amount: 250 });
    expect(refund.allowed).toBe(false);
    expect(refund.rule).toBe("escalate-large-disputed"); // a real denial, not enforcement_error
  });
});
