import { describe, it, expect } from "vitest";
import {
  runScorer,
  runDeterministicScorers,
  itemPassed,
  type ReplayedOutput,
  type ScorerConfig,
} from "../lib/eval/scorers";

const base: ReplayedOutput = {
  text: "Next.js 16 ships async params and Turbopack.",
  finish_reason: "stop",
  tool_calls: [],
  latency_ms: 400,
  total_tokens: 150,
  error: null,
};

function score(out: Partial<ReplayedOutput>, cfg: ScorerConfig) {
  return runScorer({ ...base, ...out }, cfg);
}

describe("text scorers", () => {
  it("exact_match", () => {
    expect(score({ text: "hi" }, { type: "exact_match", expected: "hi" })?.passed).toBe(true);
    expect(score({ text: "hi!" }, { type: "exact_match", expected: "hi" })?.passed).toBe(false);
  });
  it("contains (case-insensitive)", () => {
    expect(score({}, { type: "contains", value: "turbopack", caseInsensitive: true })?.passed).toBe(true);
    expect(score({}, { type: "contains", value: "webpack" })?.passed).toBe(false);
  });
  it("not_contains", () => {
    expect(score({}, { type: "not_contains", value: "error" })?.passed).toBe(true);
    expect(score({ text: "an error occurred" }, { type: "not_contains", value: "error" })?.passed).toBe(false);
  });
  it("regex", () => {
    expect(score({}, { type: "regex", pattern: "Next\\.js \\d+" })?.passed).toBe(true);
    expect(score({}, { type: "regex", pattern: "^\\d+$" })?.passed).toBe(false);
    expect(score({}, { type: "regex", pattern: "(" })?.passed).toBe(false); // invalid → fail, no throw
  });
});

describe("tool scorers", () => {
  const withTool: Partial<ReplayedOutput> = {
    tool_calls: [{ tool_name: "send_email", input: { to: "a@b.com", subject: "x" } }],
  };
  it("tool_called + argEquals", () => {
    expect(score(withTool, { type: "tool_called", tool: "send_email" })?.passed).toBe(true);
    expect(
      score(withTool, { type: "tool_called", tool: "send_email", argEquals: { to: "a@b.com" } })?.passed
    ).toBe(true);
    expect(
      score(withTool, { type: "tool_called", tool: "send_email", argEquals: { to: "x@y.com" } })?.passed
    ).toBe(false);
    expect(score(withTool, { type: "tool_called", tool: "web_search" })?.passed).toBe(false);
  });
  it("tool_not_called", () => {
    expect(score(withTool, { type: "tool_not_called", tool: "web_search" })?.passed).toBe(true);
    expect(score(withTool, { type: "tool_not_called", tool: "send_email" })?.passed).toBe(false);
  });
});

describe("deep tool-arg scorer (paths + operators)", () => {
  const out: Partial<ReplayedOutput> = {
    tool_calls: [
      { tool_name: "issue_refund", input: { amount: 250, currency: "USD", customer: { tier: "gold", id: 8842 }, tags: ["disputed", "vip"] } },
    ],
  };
  it("numeric comparisons on a nested-free path", () => {
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "amount", op: "lte", value: 500 })?.passed).toBe(true);
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "amount", op: "lte", value: 100 })?.passed).toBe(false);
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "amount", op: "gt", value: 100 })?.passed).toBe(true);
  });
  it("dot-path into a nested object", () => {
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "customer.tier", op: "eq", value: "gold" })?.passed).toBe(true);
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "customer.tier", op: "oneOf", value: ["silver", "gold"] })?.passed).toBe(true);
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "customer.id", op: "type", value: "number" })?.passed).toBe(true);
  });
  it("array indexing + contains", () => {
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "tags.0", op: "eq", value: "disputed" })?.passed).toBe(true);
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "tags", op: "contains", value: "vip" })?.passed).toBe(true);
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "tags", op: "contains", value: "refunded" })?.passed).toBe(false);
  });
  it("exists / absent / regex", () => {
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "customer.tier", op: "exists" })?.passed).toBe(true);
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "customer.email", op: "absent" })?.passed).toBe(true);
    expect(score(out, { type: "tool_arg", tool: "issue_refund", path: "currency", op: "regex", value: "^[A-Z]{3}$" })?.passed).toBe(true);
  });
  it("fails cleanly when the tool was not called", () => {
    expect(score({ tool_calls: [] }, { type: "tool_arg", tool: "issue_refund", path: "amount", op: "exists" })?.passed).toBe(false);
  });
});

describe("JSON output scorers", () => {
  it("json_valid accepts JSON (incl. prose-wrapped) and rejects non-JSON", () => {
    expect(score({ text: '{"a":1}' }, { type: "json_valid" })?.passed).toBe(true);
    expect(score({ text: 'Here you go: {"a":1} — done' }, { type: "json_valid" })?.passed).toBe(true);
    expect(score({ text: "not json at all" }, { type: "json_valid" })?.passed).toBe(false);
  });
  it("json_schema validates type, required keys, nested properties and array items", () => {
    const text = JSON.stringify({ status: "ok", count: 3, items: [{ id: "a" }, { id: "b" }] });
    expect(score({ text }, {
      type: "json_schema",
      schema: {
        type: "object",
        required: ["status", "items"],
        properties: {
          status: { type: "string" },
          count: { type: "number" },
          items: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
        },
      },
    })?.passed).toBe(true);
  });
  it("json_schema fails on a missing required key, a wrong type, and a bad array element", () => {
    expect(score({ text: '{"status":"ok"}' }, { type: "json_schema", schema: { type: "object", required: ["count"] } })?.passed).toBe(false);
    expect(score({ text: '{"count":"three"}' }, { type: "json_schema", schema: { type: "object", properties: { count: { type: "number" } } } })?.passed).toBe(false);
    expect(score({ text: '{"items":[{"id":1}]}' }, { type: "json_schema", schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } } } })?.passed).toBe(false);
    expect(score({ text: "nope" }, { type: "json_schema", schema: { type: "object" } })?.passed).toBe(false);
  });
});

describe("outcome scorers", () => {
  it("finish_reason", () => {
    expect(score({}, { type: "finish_reason", equals: "stop" })?.passed).toBe(true);
    expect(score({}, { type: "finish_reason", equals: "tool-calls" })?.passed).toBe(false);
  });
  it("no_error", () => {
    expect(score({}, { type: "no_error" })?.passed).toBe(true);
    expect(score({ error: { message: "boom" } }, { type: "no_error" })?.passed).toBe(false);
  });
  it("latency & token budgets", () => {
    expect(score({ latency_ms: 400 }, { type: "max_latency_ms", budget: 500 })?.passed).toBe(true);
    expect(score({ latency_ms: 900 }, { type: "max_latency_ms", budget: 500 })?.passed).toBe(false);
    expect(score({ total_tokens: 150 }, { type: "max_total_tokens", budget: 200 })?.passed).toBe(true);
    expect(score({ total_tokens: 300 }, { type: "max_total_tokens", budget: 200 })?.passed).toBe(false);
  });
});

describe("aggregation", () => {
  it("llm_judge is deferred (null) in deterministic pass", () => {
    expect(score({}, { type: "llm_judge", rubric: "is it nice?" })).toBeNull();
  });
  it("an item passes only if every scorer passes", () => {
    const out = base;
    const all: ScorerConfig[] = [
      { type: "no_error" },
      { type: "finish_reason", equals: "stop" },
      { type: "contains", value: "Turbopack" },
    ];
    expect(itemPassed(runDeterministicScorers(out, all))).toBe(true);

    const withFail: ScorerConfig[] = [...all, { type: "contains", value: "webpack" }];
    expect(itemPassed(runDeterministicScorers(out, withFail))).toBe(false);
  });
  it("empty scorer list does not pass (must assert something)", () => {
    expect(itemPassed([])).toBe(false);
  });
});
