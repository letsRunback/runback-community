/**
 * Scorers — assertions a replayed step output must satisfy. Deterministic scorers
 * run with no LLM; `llm_judge` is evaluated by the runner (it needs a model call).
 *
 * Design: a dataset item carries a list of ScorerConfig. An eval replays the
 * item's captured request and runs every scorer against the output. This is the
 * unit the CI Gate diffs across versions.
 */

/** Comparison operators for deep field assertions (tool args, JSON output). */
export type CmpOp =
  | "eq" | "ne" | "gt" | "gte" | "lt" | "lte"
  | "regex" | "exists" | "absent" | "type" | "oneOf" | "contains";

/** A lightweight JSON shape — type + required keys + nested properties/items. */
export interface JsonShape {
  type?: "object" | "array" | "string" | "number" | "boolean" | "null";
  /** For objects: dot-paths that must be present (array-aware). */
  required?: string[];
  /** For objects: nested shape per top-level key. */
  properties?: Record<string, JsonShape>;
  /** For arrays: shape every element must satisfy. */
  items?: JsonShape;
}

/** One weighted criterion of a structured rubric the llm_judge grades against. */
export interface JudgeCriterion {
  name: string;
  /** Relative weight (default 1). The aggregate is the weighted mean of criteria. */
  weight?: number;
  /** What "satisfied" means for this criterion — handed to the judge. */
  description?: string;
}

export type ScorerConfig =
  | { type: "exact_match"; expected: string }
  | { type: "contains"; value: string; caseInsensitive?: boolean }
  | { type: "not_contains"; value: string; caseInsensitive?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "tool_called"; tool: string; argEquals?: Record<string, unknown> }
  | { type: "tool_not_called"; tool: string }
  /** Deep assertion on a tool call's argument: dot-path + comparison operator. */
  | { type: "tool_arg"; tool: string; path: string; op: CmpOp; value?: unknown }
  | { type: "finish_reason"; equals: string }
  | { type: "no_error" }
  | { type: "max_latency_ms"; budget: number }
  | { type: "max_total_tokens"; budget: number }
  /** The output text must parse as JSON. */
  | { type: "json_valid" }
  /** The output text must parse as JSON AND satisfy a shape. */
  | { type: "json_schema"; schema: JsonShape }
  | { type: "llm_judge"; rubric: string; threshold?: number; criteria?: JudgeCriterion[]; samples?: number };

export interface ReplayedOutput {
  text: string | null;
  finish_reason: string | null;
  tool_calls: { tool_name: string; input: unknown }[];
  latency_ms: number | null;
  total_tokens: number | null;
  error?: { message: string } | null;
}

export interface ScoreResult {
  scorer: string;
  passed: boolean;
  score: number; // 0..1
  detail?: string;
  /** Set only by llm_judge scorers: the resolved judge model id, so calibration
   *  data can be keyed by judge identity, not just by rubric (lib/eval/calibration.ts). */
  judgeModel?: string;
}

const ok = (scorer: string, detail?: string): ScoreResult => ({ scorer, passed: true, score: 1, detail });
const no = (scorer: string, detail: string): ScoreResult => ({ scorer, passed: false, score: 0, detail });

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (typeof a !== "object") return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

/** Sentinel distinct from `undefined` so "path exists but holds undefined" is detectable. */
const MISSING = Symbol("missing");

/** Resolve a dot-path (array-aware: a numeric segment indexes; otherwise maps would be ambiguous). */
function getPath(root: unknown, path: string): unknown {
  if (path === "") return root;
  let node: unknown = root;
  for (const seg of path.split(".")) {
    if (node == null || typeof node !== "object") return MISSING;
    if (Array.isArray(node)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= node.length) return MISSING;
      node = node[i];
    } else {
      if (!(seg in (node as Record<string, unknown>))) return MISSING;
      node = (node as Record<string, unknown>)[seg];
    }
  }
  return node;
}

/** The JSON type of a value, with array/null distinguished from object. */
function jsonTypeOf(v: unknown): JsonShape["type"] {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "object") return "object";
  if (t === "string" || t === "number" || t === "boolean") return t;
  return undefined; // undefined / function — not JSON
}

/** Apply one comparison operator. Returns [passed, detail]. Pure, total (never throws). */
function compareOp(actual: unknown, op: CmpOp, expected: unknown): [boolean, string] {
  const present = actual !== MISSING;
  const a = present ? actual : undefined;
  switch (op) {
    case "exists":
      return [present, present ? "present" : "missing"];
    case "absent":
      return [!present, present ? `present (${JSON.stringify(a)})` : "absent"];
    case "eq":
      return [deepEqual(a, expected), `${JSON.stringify(a)} ${deepEqual(a, expected) ? "=" : "≠"} ${JSON.stringify(expected)}`];
    case "ne":
      return [!deepEqual(a, expected), `${JSON.stringify(a)} ${!deepEqual(a, expected) ? "≠" : "="} ${JSON.stringify(expected)}`];
    case "gt": case "gte": case "lt": case "lte": {
      if (typeof a !== "number" || typeof expected !== "number") return [false, `not both numbers: ${JSON.stringify(a)} ${op} ${JSON.stringify(expected)}`];
      const r = op === "gt" ? a > expected : op === "gte" ? a >= expected : op === "lt" ? a < expected : a <= expected;
      return [r, `${a} ${op} ${expected}`];
    }
    case "regex": {
      let re: RegExp;
      try { re = new RegExp(String(expected)); } catch { return [false, `invalid pattern /${String(expected)}/`]; }
      const s = typeof a === "string" ? a : JSON.stringify(a);
      return [re.test(s), re.test(s) ? "matched" : `no match for /${String(expected)}/`];
    }
    case "type":
      return [jsonTypeOf(a) === expected, `type ${jsonTypeOf(a)} ${jsonTypeOf(a) === expected ? "=" : "≠"} ${String(expected)}`];
    case "oneOf": {
      const arr = Array.isArray(expected) ? expected : [];
      const hit = arr.some((x) => deepEqual(a, x));
      return [hit, hit ? "in set" : `${JSON.stringify(a)} not in ${JSON.stringify(arr)}`];
    }
    case "contains": {
      if (typeof a === "string") return [a.includes(String(expected)), a.includes(String(expected)) ? "contains" : `missing "${String(expected)}"`];
      if (Array.isArray(a)) { const hit = a.some((x) => deepEqual(x, expected)); return [hit, hit ? "contains" : `missing ${JSON.stringify(expected)}`]; }
      return [false, `not a string/array: ${JSON.stringify(a)}`];
    }
  }
}

/** Validate a parsed value against a lightweight JSON shape. Returns [ok, detail]. */
function matchShape(value: unknown, shape: JsonShape, at = "$"): [boolean, string] {
  if (shape.type) {
    const actual = jsonTypeOf(value);
    if (actual !== shape.type) return [false, `${at}: expected ${shape.type}, got ${actual ?? "non-JSON"}`];
  }
  if (shape.required) {
    for (const key of shape.required) {
      if (getPath(value, key) === MISSING) return [false, `${at}: missing required "${key}"`];
    }
  }
  if (shape.properties && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, sub] of Object.entries(shape.properties)) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue; // presence is governed by `required`, not `properties`
      const [ok2, why] = matchShape(child, sub, `${at}.${key}`);
      if (!ok2) return [false, why];
    }
  }
  if (shape.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const [ok2, why] = matchShape(value[i], shape.items, `${at}[${i}]`);
      if (!ok2) return [false, why];
    }
  }
  return [true, "matches shape"];
}

/** Parse the output text as JSON, tolerating prose/code-fences around a single object/array. */
export function parseJsonLoose(text: string | null): { ok: boolean; value?: unknown } {
  if (text == null) return { ok: false };
  const trimmed = text.trim();
  try { return { ok: true, value: JSON.parse(trimmed) }; } catch { /* try to extract */ }
  const match = trimmed.match(/[[{][\s\S]*[\]}]/);
  if (match) {
    try { return { ok: true, value: JSON.parse(match[0]) }; } catch { /* give up */ }
  }
  return { ok: false };
}

/** Evaluate a single deterministic scorer. `llm_judge` is skipped here (runner handles it). */
export function runScorer(out: ReplayedOutput, cfg: ScorerConfig): ScoreResult | null {
  switch (cfg.type) {
    case "exact_match":
      return (out.text ?? "") === cfg.expected
        ? ok("exact_match")
        : no("exact_match", `expected exactly "${cfg.expected}"`);
    case "contains": {
      const hay = cfg.caseInsensitive ? (out.text ?? "").toLowerCase() : out.text ?? "";
      const needle = cfg.caseInsensitive ? cfg.value.toLowerCase() : cfg.value;
      return hay.includes(needle) ? ok("contains") : no("contains", `missing "${cfg.value}"`);
    }
    case "not_contains": {
      const hay = cfg.caseInsensitive ? (out.text ?? "").toLowerCase() : out.text ?? "";
      const needle = cfg.caseInsensitive ? cfg.value.toLowerCase() : cfg.value;
      return hay.includes(needle) ? no("not_contains", `should not contain "${cfg.value}"`) : ok("not_contains");
    }
    case "regex": {
      let re: RegExp;
      try {
        re = new RegExp(cfg.pattern, cfg.flags);
      } catch {
        return no("regex", `invalid pattern /${cfg.pattern}/`);
      }
      return re.test(out.text ?? "") ? ok("regex") : no("regex", `no match for /${cfg.pattern}/`);
    }
    case "tool_called": {
      const call = out.tool_calls.find((t) => t.tool_name === cfg.tool);
      if (!call) return no("tool_called", `${cfg.tool} was not called`);
      if (cfg.argEquals) {
        for (const [k, v] of Object.entries(cfg.argEquals)) {
          const actual = (call.input as Record<string, unknown> | null)?.[k];
          if (!deepEqual(actual, v)) {
            return no("tool_called", `${cfg.tool}.${k} = ${JSON.stringify(actual)} ≠ ${JSON.stringify(v)}`);
          }
        }
      }
      return ok("tool_called");
    }
    case "tool_not_called":
      return out.tool_calls.some((t) => t.tool_name === cfg.tool)
        ? no("tool_not_called", `${cfg.tool} should not have been called`)
        : ok("tool_not_called");
    case "tool_arg": {
      const call = out.tool_calls.find((t) => t.tool_name === cfg.tool);
      if (!call) return no("tool_arg", `${cfg.tool} was not called`);
      const actual = getPath(call.input, cfg.path);
      const [passed, detail] = compareOp(actual, cfg.op, cfg.value);
      return passed
        ? ok("tool_arg", `${cfg.tool}.${cfg.path} ${detail}`)
        : no("tool_arg", `${cfg.tool}.${cfg.path}: ${detail}`);
    }
    case "json_valid": {
      const p = parseJsonLoose(out.text);
      return p.ok ? ok("json_valid") : no("json_valid", "output is not valid JSON");
    }
    case "json_schema": {
      const p = parseJsonLoose(out.text);
      if (!p.ok) return no("json_schema", "output is not valid JSON");
      const [passed, detail] = matchShape(p.value, cfg.schema);
      return passed ? ok("json_schema") : no("json_schema", detail);
    }
    case "finish_reason":
      return out.finish_reason === cfg.equals
        ? ok("finish_reason")
        : no("finish_reason", `finish was "${out.finish_reason}", expected "${cfg.equals}"`);
    case "no_error":
      return out.error ? no("no_error", out.error.message) : ok("no_error");
    case "max_latency_ms":
      return (out.latency_ms ?? 0) <= cfg.budget
        ? ok("max_latency_ms")
        : no("max_latency_ms", `${out.latency_ms}ms > ${cfg.budget}ms`);
    case "max_total_tokens":
      return (out.total_tokens ?? 0) <= cfg.budget
        ? ok("max_total_tokens")
        : no("max_total_tokens", `${out.total_tokens} tok > ${cfg.budget}`);
    case "llm_judge":
      return null; // handled asynchronously by the runner
  }
}

/** Run all deterministic scorers; returns results (llm_judge omitted — see runner). */
export function runDeterministicScorers(out: ReplayedOutput, scorers: ScorerConfig[]): ScoreResult[] {
  const results: ScoreResult[] = [];
  for (const cfg of scorers) {
    const r = runScorer(out, cfg);
    if (r) results.push(r);
  }
  return results;
}

/** An item passes only if every scorer passes. */
export function itemPassed(results: ScoreResult[]): boolean {
  return results.length > 0 && results.every((r) => r.passed);
}
