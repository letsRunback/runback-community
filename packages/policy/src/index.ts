/**
 * Policy-as-code — a precise, deterministic policy engine.
 *
 * ONE engine, three uses:
 *   • the release gate (eval-time), • policy simulation (over history), and
 *   • runtime ENFORCEMENT (a pre-hook in the agent, in-process — no network).
 *
 * A policy is a named, versioned set of RULES over an agent's decision:
 *   assert  — a predicate that must always hold.
 *   require — "WHEN <antecedent> THEN <consequent>": the consequent must hold
 *             whenever the antecedent does (N/A otherwise).
 * Predicates compose (and/or/not) and read the OUTPUT (tool calls + args, text,
 * finish reason) and the INPUT text. Everything is deterministic — no LLM judge —
 * so a verdict is exact, repeatable, and auditable.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Cmp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte";

export type Predicate =
  | { op: "tool_called"; tool: string }
  | { op: "tool_arg"; tool: string; path: string; cmp: Cmp; value: number | string | boolean }
  | { op: "output_matches"; pattern: string; flags?: string }
  | { op: "input_matches"; pattern: string; flags?: string }
  | { op: "finish_reason"; equals: string }
  | { op: "tool_call_count"; cmp: Cmp; value: number }
  | { op: "no_error" }
  | { op: "and"; all: Predicate[] }
  | { op: "or"; any: Predicate[] }
  | { op: "not"; pred: Predicate };

export type PolicyRule =
  | { id: string; description?: string; kind: "assert"; pred: Predicate }
  | { id: string; description?: string; kind: "require"; when: Predicate; then: Predicate };

export interface Policy {
  name: string;
  version: number;
  rules: PolicyRule[];
}

export interface RuleResult {
  id: string;
  description?: string;
  applicable: boolean;
  passed: boolean;
  detail: string;
}
export interface PolicyResult {
  passed: boolean;
  results: RuleResult[];
}

/** The minimal decision shape the engine reads (a superset of ReplayedOutput). */
export interface PolicyOutput {
  text: string | null;
  finish_reason: string | null;
  tool_calls: { tool_name: string; input: unknown }[];
  error?: { message: string } | null;
}

export interface PolicyContext {
  output: PolicyOutput;
  inputText: string;
}

function atPath(obj: any, path: string): unknown {
  return path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), obj);
}

function compare(a: unknown, cmp: Cmp, b: unknown): boolean {
  if (cmp === "eq") return a === b || String(a) === String(b);
  if (cmp === "ne") return !(a === b || String(a) === String(b));
  const x = Number(a), y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  if (cmp === "lt") return x < y;
  if (cmp === "lte") return x <= y;
  if (cmp === "gt") return x > y;
  return x >= y;
}

// Compile a user-supplied regex safely. Returns null if the pattern is invalid,
// empty, or exceeds the length limit that would risk catastrophic backtracking.
function safeRegex(pattern: string, flags?: string): RegExp | null {
  if (!pattern || pattern.length > 500) return null;
  const safeFlags = (flags ?? "i").replace(/[^gimsuy]/g, "");
  try { return new RegExp(pattern, safeFlags); } catch { return null; }
}

export function evalPredicate(p: Predicate, ctx: PolicyContext): boolean {
  const calls = ctx.output.tool_calls ?? [];
  switch (p.op) {
    case "tool_called":
      return calls.some((c) => c.tool_name === p.tool);
    case "tool_arg":
      return calls.some((c) => c.tool_name === p.tool && compare(atPath(c.input, p.path), p.cmp, p.value));
    case "output_matches": {
      const re = safeRegex(p.pattern, p.flags);
      return re ? re.test(ctx.output.text ?? "") : false;
    }
    case "input_matches": {
      const re = safeRegex(p.pattern, p.flags);
      return re ? re.test(ctx.inputText ?? "") : false;
    }
    case "finish_reason":
      return (ctx.output.finish_reason ?? "") === p.equals;
    case "tool_call_count":
      return compare(calls.length, p.cmp, p.value);
    case "no_error":
      return !ctx.output.error;
    case "and":
      return p.all.every((q) => evalPredicate(q, ctx));
    case "or":
      return p.any.some((q) => evalPredicate(q, ctx));
    case "not":
      return !evalPredicate(p.pred, ctx);
  }
}

const describe = (p: Predicate): string => {
  switch (p.op) {
    case "tool_called": return `calls ${p.tool}`;
    case "tool_arg": return `${p.tool}.${p.path} ${p.cmp} ${p.value}`;
    case "output_matches": return `output matches /${p.pattern}/`;
    case "input_matches": return `input matches /${p.pattern}/`;
    case "finish_reason": return `finishes "${p.equals}"`;
    case "tool_call_count": return `tool-call count ${p.cmp} ${p.value}`;
    case "no_error": return `no error`;
    case "and": return p.all.map(describe).join(" and ");
    case "or": return p.any.map(describe).join(" or ");
    case "not": return `not (${describe(p.pred)})`;
  }
};

/**
 * Aggregation is a plain AND over every rule (`results.every`) — intentional,
 * not a placeholder for a future priority/override system. There is no rule
 * ordering, priority, or conflict-resolution concept: if two rules directly
 * contradict each other for the same action, both are still individually
 * evaluated and the policy simply never passes for that action. See
 * packages/policy/test/enforce.test.ts's "rule aggregation" suite for the
 * confirming tests.
 */
export function evaluatePolicy(policy: Policy, ctx: PolicyContext): PolicyResult {
  const results: RuleResult[] = policy.rules.map((rule) => {
    if (rule.kind === "assert") {
      const passed = evalPredicate(rule.pred, ctx);
      return { id: rule.id, description: rule.description, applicable: true, passed, detail: `must ${describe(rule.pred)} — ${passed ? "ok" : "violated"}` };
    }
    const fired = evalPredicate(rule.when, ctx);
    if (!fired) return { id: rule.id, description: rule.description, applicable: false, passed: true, detail: `when ${describe(rule.when)} — not triggered` };
    const passed = evalPredicate(rule.then, ctx);
    return { id: rule.id, description: rule.description, applicable: true, passed, detail: `when ${describe(rule.when)} → must ${describe(rule.then)} — ${passed ? "ok" : "violated"}` };
  });
  return { passed: results.every((r) => r.passed), results };
}

/** Extract the user-facing input text from a captured request for input_matches. */
export function inputTextOf(request: any): string {
  const msgs = request?.messages ?? [];
  return msgs
    .filter((m: any) => m.role === "user")
    .map((m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

const PREDICATE_OPS = new Set([
  "tool_called", "tool_arg", "output_matches", "input_matches",
  "finish_reason", "tool_call_count", "no_error", "and", "or", "not",
]);

/**
 * Recursively validate a predicate tree. assertValidPolicy used to check only
 * that a rule's top-level pred/when/then was PRESENT — a truthy object like
 * `{op: "not"}` (missing its own nested `pred`) or `{op: "and", all: "x"}`
 * (a non-array `all`) satisfied that shallow check and was saved/imported
 * fine, then threw deep inside evalPredicate the first time anything actually
 * evaluated it ("Cannot read properties of undefined (reading 'op')", or
 * "p.all.every is not a function") — the exact crash class this function
 * exists to catch, just not far enough down the tree. Validating the whole
 * tree here means a malformed policy is rejected with a clear message at
 * save/import time, before it can ever reach the evaluator.
 */
function assertValidPredicate(pred: any, where: string): void {
  if (!pred || typeof pred !== "object" || typeof pred.op !== "string") {
    throw new Error(`${where}: a predicate needs an "op".`);
  }
  if (!PREDICATE_OPS.has(pred.op)) {
    throw new Error(`${where}: unknown predicate op "${pred.op}".`);
  }
  switch (pred.op) {
    case "tool_called":
      if (typeof pred.tool !== "string" || !pred.tool) throw new Error(`${where}: tool_called needs a "tool".`);
      return;
    case "tool_arg":
      if (typeof pred.tool !== "string" || !pred.tool) throw new Error(`${where}: tool_arg needs a "tool".`);
      if (typeof pred.path !== "string" || !pred.path) throw new Error(`${where}: tool_arg needs a "path".`);
      if (typeof pred.cmp !== "string") throw new Error(`${where}: tool_arg needs a "cmp".`);
      return;
    case "output_matches":
    case "input_matches":
      if (typeof pred.pattern !== "string") throw new Error(`${where}: ${pred.op} needs a "pattern".`);
      return;
    case "finish_reason":
      if (typeof pred.equals !== "string") throw new Error(`${where}: finish_reason needs "equals".`);
      return;
    case "tool_call_count":
      if (typeof pred.cmp !== "string") throw new Error(`${where}: tool_call_count needs a "cmp".`);
      return;
    case "no_error":
      return;
    case "and":
      if (!Array.isArray(pred.all) || pred.all.length === 0) throw new Error(`${where}: "and" needs a non-empty "all" array.`);
      pred.all.forEach((q: any, i: number) => assertValidPredicate(q, `${where}.all[${i}]`));
      return;
    case "or":
      if (!Array.isArray(pred.any) || pred.any.length === 0) throw new Error(`${where}: "or" needs a non-empty "any" array.`);
      pred.any.forEach((q: any, i: number) => assertValidPredicate(q, `${where}.any[${i}]`));
      return;
    case "not":
      assertValidPredicate(pred.pred, `${where}.pred`);
      return;
  }
}

export function assertValidPolicy(p: any): asserts p is Policy {
  if (!p || typeof p.name !== "string" || !Array.isArray(p.rules)) throw new Error("Policy needs a name and a rules[] array.");
  for (const r of p.rules) {
    if (!r.id || (r.kind !== "assert" && r.kind !== "require")) throw new Error(`Each rule needs an id and kind "assert" or "require".`);
    if (r.kind === "assert" && !r.pred) throw new Error(`Rule ${r.id}: assert needs a pred.`);
    if (r.kind === "require" && (!r.when || !r.then)) throw new Error(`Rule ${r.id}: require needs when and then.`);
    if (r.kind === "assert") assertValidPredicate(r.pred, `Rule ${r.id}`);
    else {
      assertValidPredicate(r.when, `Rule ${r.id}.when`);
      assertValidPredicate(r.then, `Rule ${r.id}.then`);
    }
  }
}

/* ── Runtime enforcement ─────────────────────────────────────────────────────── */

export interface PendingCall {
  tool_name: string;
  input: unknown;
}

export interface EnforcementDecision {
  allowed: boolean;
  /** The rule id that blocked the action, if any. */
  rule: string | null;
  /** Human-readable reason. */
  detail: string | null;
  /** True only when a real ruleset was actually checked against this call — false when there was nothing to enforce. */
  evaluated: boolean;
}

/**
 * Evaluate a PENDING tool call against the policy, given the tool calls already
 * made in this run. Returns whether the action is allowed — the in-process
 * decision a runtime guardrail makes BEFORE the tool executes. Deterministic and
 * synchronous, so it adds no network hop to the agent's critical path.
 *
 * Example: "require: when issue_refund.amount>100 AND input~disputed THEN
 * escalate_to_human is called" blocks the refund unless escalate ran first.
 */
export function enforcePolicy(
  rules: PolicyRule[],
  priorCalls: PendingCall[],
  pending: PendingCall,
  inputText: string
): EnforcementDecision {
  if (!rules || rules.length === 0) return { allowed: true, rule: null, detail: null, evaluated: false };
  const output: PolicyOutput = {
    text: null,
    finish_reason: "tool-call",
    tool_calls: [...priorCalls, pending],
    error: null,
  };
  const res = evaluatePolicy({ name: "(enforcement)", version: 0, rules }, { output, inputText });
  if (res.passed) return { allowed: true, rule: null, detail: null, evaluated: true };
  const failed = res.results.find((r) => r.applicable && !r.passed);
  return { allowed: false, rule: failed?.id ?? "policy", detail: failed?.detail ?? "policy violated", evaluated: true };
}
