import { describe, it, expect } from "vitest";
import { toolsCoveredByRules, computeCoverageGaps } from "../policyCoverage";
import type { PolicyRule } from "../policy";

const assertRule = (id: string, tool: string): PolicyRule => ({
  id, kind: "assert",
  pred: { op: "tool_called", tool },
});

const requireRule = (id: string, whenTool: string, thenTool: string): PolicyRule => ({
  id, kind: "require",
  when: { op: "tool_arg", tool: whenTool, path: "amount", cmp: "gt", value: 100 },
  then: { op: "tool_called", tool: thenTool },
});

describe("toolsCoveredByRules", () => {
  it("finds a tool named directly by an assert rule", () => {
    expect(toolsCoveredByRules([assertRule("r1", "exec_shell")])).toEqual(new Set(["exec_shell"]));
  });

  it("finds tools named on BOTH sides of a require rule (when and then)", () => {
    const covered = toolsCoveredByRules([requireRule("r1", "issue_refund", "escalate_to_human")]);
    expect(covered).toEqual(new Set(["issue_refund", "escalate_to_human"]));
  });

  it("recurses through and/or/not to find nested tool references", () => {
    const rule: PolicyRule = {
      id: "r1", kind: "assert",
      pred: {
        op: "and", all: [
          { op: "or", any: [{ op: "tool_called", tool: "write_file" }, { op: "tool_called", tool: "delete_file" }] },
          { op: "not", pred: { op: "tool_arg", tool: "read_secret", path: "scope", cmp: "eq", value: "prod" } },
        ],
      },
    };
    expect(toolsCoveredByRules([rule])).toEqual(new Set(["write_file", "delete_file", "read_secret"]));
  });

  it("does NOT credit a generic rule (no tool_called/tool_arg) with covering any tool", () => {
    // input_matches/output_matches/no_error/finish_reason/tool_call_count
    // evaluate on every decision, but none of them name a specific tool —
    // this is the deliberate scope limit documented in policyCoverage.ts.
    const generic: PolicyRule = { id: "r1", kind: "assert", pred: { op: "no_error" } };
    expect(toolsCoveredByRules([generic])).toEqual(new Set());
  });

  it("unions coverage across multiple rules", () => {
    const covered = toolsCoveredByRules([assertRule("r1", "a"), assertRule("r2", "b")]);
    expect(covered).toEqual(new Set(["a", "b"]));
  });

  // A real production incident: an org that imported a Policy Library
  // template before the importTemplate() validation fix (see policyLibrary.ts
  // and sql/repair_broken_imported_policies.sql) kept a rule in the old,
  // pre-fix shape ({type, tool, condition, message} — no `.op` anywhere)
  // sitting live in ad_policies. Reading it here used to throw
  // "Cannot read properties of undefined (reading 'op')" and take down
  // coverage-gap analysis for the ENTIRE org, not just that one rule.
  it("does not throw on a malformed pre-fix-shape rule, and skips it rather than crediting it with covering anything", () => {
    const brokenRule = { type: "tool_block", tool: "issue_approval", condition: "args.amount > config.max_auto_approve", message: "..." } as unknown as PolicyRule;
    expect(() => toolsCoveredByRules([brokenRule])).not.toThrow();
    expect(toolsCoveredByRules([brokenRule])).toEqual(new Set());
  });

  it("does not throw on a rule with a missing/undefined pred, when, or then", () => {
    const noPred = { id: "r1", kind: "assert" } as unknown as PolicyRule;
    const noWhenThen = { id: "r2", kind: "require" } as unknown as PolicyRule;
    expect(() => toolsCoveredByRules([noPred, noWhenThen])).not.toThrow();
  });

  it("still credits the OTHER valid rules in the set when one rule is malformed", () => {
    const brokenRule = { type: "tool_block", tool: "issue_approval" } as unknown as PolicyRule;
    const covered = toolsCoveredByRules([brokenRule, assertRule("r1", "update_customer")]);
    expect(covered).toEqual(new Set(["update_customer"]));
  });
});

describe("computeCoverageGaps", () => {
  it("flags a called tool that no rule names", () => {
    const gaps = computeCoverageGaps([assertRule("r1", "issue_refund")], [
      { tool_name: "issue_refund", count: 5 },
      { tool_name: "exec_shell", count: 3 },
    ]);
    expect(gaps).toEqual([{ tool_name: "exec_shell", count: 3 }]);
  });

  it("sorts gaps by call count, most-used first — the biggest live blind spot leads", () => {
    const gaps = computeCoverageGaps([], [
      { tool_name: "rarely_used", count: 2 },
      { tool_name: "frequently_used", count: 50 },
      { tool_name: "sometimes_used", count: 10 },
    ]);
    expect(gaps.map((g) => g.tool_name)).toEqual(["frequently_used", "sometimes_used", "rarely_used"]);
  });

  it("returns nothing when every called tool has a rule that names it", () => {
    const gaps = computeCoverageGaps(
      [assertRule("r1", "a"), assertRule("r2", "b")],
      [{ tool_name: "a", count: 1 }, { tool_name: "b", count: 1 }]
    );
    expect(gaps).toEqual([]);
  });

  it("returns nothing when nothing was called (empty usage)", () => {
    expect(computeCoverageGaps([assertRule("r1", "a")], [])).toEqual([]);
  });
});
