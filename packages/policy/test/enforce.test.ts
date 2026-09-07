import { describe, it, expect } from "vitest";
import { enforcePolicy, assertValidPolicy, evaluatePolicy, type PolicyRule } from "../src/index";

// "When a refund over $100 is issued on a disputed charge, escalate_to_human must be called."
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
const ctx = "Customer #8842 disputed a $250 charge and wants a refund.";

describe("enforcePolicy (runtime pre-hook)", () => {
  it("BLOCKS a $250 refund on a disputed charge when escalate hasn't run", () => {
    const d = enforcePolicy(rules, [{ tool_name: "lookup_customer", input: { id: 8842 } }], { tool_name: "issue_refund", input: { amount: 250 } }, ctx);
    expect(d.allowed).toBe(false);
    expect(d.rule).toBe("escalate-large-disputed");
  });

  it("ALLOWS the refund once escalate_to_human has been called first", () => {
    const prior = [
      { tool_name: "lookup_customer", input: { id: 8842 } },
      { tool_name: "escalate_to_human", input: { reason: "disputed" } },
    ];
    const d = enforcePolicy(rules, prior, { tool_name: "issue_refund", input: { amount: 250 } }, ctx);
    expect(d.allowed).toBe(true);
  });

  it("ALLOWS a small refund (rule antecedent doesn't fire)", () => {
    const d = enforcePolicy(rules, [], { tool_name: "issue_refund", input: { amount: 40 } }, ctx);
    expect(d.allowed).toBe(true);
  });

  it("ALLOWS everything when there are no rules", () => {
    expect(enforcePolicy([], [], { tool_name: "issue_refund", input: { amount: 9999 } }, ctx).allowed).toBe(true);
  });
});

describe("assertValidPolicy — rejects malformed predicates before they reach the evaluator", () => {
  // A rule's own pred/when/then being PRESENT used to be the whole check — a
  // truthy-but-incomplete predicate nested inside it (missing "not"'s own
  // pred, a non-array "all"/"any") passed validation and then threw deep
  // inside evalPredicate the first time anything actually ran it. These cases
  // reproduce that exact crash class and confirm assertValidPolicy now rejects
  // it at the door, with a message instead of a raw TypeError.
  it("rejects a top-level pred with no op at all", () => {
    expect(() => assertValidPolicy({ name: "p", rules: [{ id: "r1", kind: "assert", pred: {} }] }))
      .toThrow(/predicate needs an "op"/);
  });

  it("rejects 'not' whose own nested pred is missing (used to throw reading .op of undefined)", () => {
    const policy = { name: "p", rules: [{ id: "r1", kind: "assert", pred: { op: "not" } }] };
    expect(() => assertValidPolicy(policy)).toThrow(/predicate needs an "op"/);
    // Confirms this is not just a style nit: the same shape really does crash
    // the evaluator if it isn't caught first.
    expect(() => evaluatePolicy(policy as never, { output: { text: null, finish_reason: null, tool_calls: [] }, inputText: "" }))
      .toThrow();
  });

  it("rejects 'and' with a non-array 'all' (used to throw '.every is not a function')", () => {
    const policy = { name: "p", rules: [{ id: "r1", kind: "assert", pred: { op: "and", all: "not-an-array" } }] };
    expect(() => assertValidPolicy(policy)).toThrow(/needs a non-empty "all" array/);
    expect(() => evaluatePolicy(policy as never, { output: { text: null, finish_reason: null, tool_calls: [] }, inputText: "" }))
      .toThrow();
  });

  it("rejects 'or' with an empty 'any' array", () => {
    expect(() => assertValidPolicy({ name: "p", rules: [{ id: "r1", kind: "assert", pred: { op: "or", any: [] } }] }))
      .toThrow(/needs a non-empty "any" array/);
  });

  it("rejects an unknown predicate op", () => {
    expect(() => assertValidPolicy({ name: "p", rules: [{ id: "r1", kind: "assert", pred: { op: "always_true" } }] }))
      .toThrow(/unknown predicate op/);
  });

  it("rejects tool_called/tool_arg missing their required fields", () => {
    expect(() => assertValidPolicy({ name: "p", rules: [{ id: "r1", kind: "assert", pred: { op: "tool_called" } }] }))
      .toThrow(/tool_called needs a "tool"/);
    expect(() => assertValidPolicy({ name: "p", rules: [{ id: "r1", kind: "assert", pred: { op: "tool_arg", tool: "t" } }] }))
      .toThrow(/needs a "path"/);
  });

  it("rejects a malformed predicate nested several levels deep inside and/or/not", () => {
    const policy = {
      name: "p",
      rules: [{
        id: "r1", kind: "assert",
        pred: { op: "and", all: [
          { op: "tool_called", tool: "x" },
          { op: "or", any: [{ op: "not", pred: { op: "tool_arg", tool: "y" } }] }, // missing path/cmp
        ] },
      }],
    };
    expect(() => assertValidPolicy(policy)).toThrow(/needs a "path"/);
  });

  it("still accepts every well-formed op, including compound ones", () => {
    const policy: { name: string; rules: PolicyRule[] } = {
      name: "p",
      rules: [
        { id: "r1", kind: "assert", pred: { op: "no_error" } },
        {
          id: "r2", kind: "require",
          when: { op: "and", all: [
            { op: "tool_arg", tool: "issue_refund", path: "amount", cmp: "gt", value: 100 },
            { op: "input_matches", pattern: "disputed" },
          ] },
          then: { op: "or", any: [{ op: "tool_called", tool: "escalate_to_human" }, { op: "not", pred: { op: "finish_reason", equals: "error" } }] },
        },
      ],
    };
    expect(() => assertValidPolicy(policy)).not.toThrow();
  });
});

describe("evaluatePolicy — rule aggregation is a plain AND over every rule, with no priority/override", () => {
  // Documents real, intentional behavior (evaluatePolicy: `results.every((r) => r.passed)`)
  // that a depth audit found had no test proving it was a deliberate choice rather than
  // an accident: the engine has no priority, ordering, or override mechanism between
  // rules. Two rules that directly contradict each other for the SAME action both still
  // have to individually pass — there is no "rule B wins" resolution, only "everything
  // must be satisfied simultaneously," which for a genuine contradiction means neither
  // outcome can ever pass.
  const mustEscalate: PolicyRule = {
    id: "must-escalate",
    kind: "assert",
    pred: { op: "tool_called", tool: "escalate_to_human" },
  };
  const mustNotEscalate: PolicyRule = {
    id: "must-not-escalate",
    kind: "assert",
    pred: { op: "not", pred: { op: "tool_called", tool: "escalate_to_human" } },
  };
  const pol = (rules: PolicyRule[]) => ({ name: "test", version: 1, rules });

  it("a genuine contradiction between two assert rules fails the whole policy no matter what happened", () => {
    const withEscalate = evaluatePolicy(pol([mustEscalate, mustNotEscalate]), { output: { tool_calls: [{ tool_name: "escalate_to_human", input: {} }] }, inputText: "" });
    expect(withEscalate.passed).toBe(false);
    expect(withEscalate.results.find((r) => r.id === "must-escalate")?.passed).toBe(true);
    expect(withEscalate.results.find((r) => r.id === "must-not-escalate")?.passed).toBe(false);

    const withoutEscalate = evaluatePolicy(pol([mustEscalate, mustNotEscalate]), { output: { tool_calls: [] }, inputText: "" });
    expect(withoutEscalate.passed).toBe(false);
    expect(withoutEscalate.results.find((r) => r.id === "must-escalate")?.passed).toBe(false);
    expect(withoutEscalate.results.find((r) => r.id === "must-not-escalate")?.passed).toBe(true);
  });

  it("rule order has no effect on the verdict — this is a set, not a sequence", () => {
    const ctx = { output: { tool_calls: [{ tool_name: "escalate_to_human", input: {} }] }, inputText: "" };
    const forward = evaluatePolicy(pol([mustEscalate, mustNotEscalate]), ctx);
    const reversed = evaluatePolicy(pol([mustNotEscalate, mustEscalate]), ctx);
    expect(forward.passed).toBe(reversed.passed);
  });

  it("two independently-passing rules both contribute — AND, not first-match-wins", () => {
    const rules: PolicyRule[] = [
      { id: "no-error", kind: "assert", pred: { op: "no_error" } },
      mustEscalate,
    ];
    const bothPass = evaluatePolicy(pol(rules), { output: { tool_calls: [{ tool_name: "escalate_to_human", input: {} }] }, inputText: "" });
    expect(bothPass.passed).toBe(true);
    expect(bothPass.results.every((r) => r.passed)).toBe(true);

    // One rule failing fails the whole evaluation even though the other rule
    // independently passed — there's no partial credit or override.
    const onePasses = evaluatePolicy(pol(rules), { output: { tool_calls: [], error: { name: "X", message: "boom" } }, inputText: "" });
    expect(onePasses.passed).toBe(false);
  });
});
