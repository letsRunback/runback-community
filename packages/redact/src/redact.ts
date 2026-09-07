import type { TraceEvent } from "@runback/schema";
import {
  RULES,
  SENSITIVE_KEYS,
  applyRule,
  BASE64_CANDIDATE,
  decodeBase64Utf8,
  type RedactionRule,
  type RedactionTier,
} from "./patterns";

export interface RedactOptions {
  /** Which built-in tier to use. `standard` (default) is high-confidence only. */
  preset?: RedactionTier;
  /** Replace the built-in rule set entirely. */
  rules?: RedactionRule[];
  /** Add rules on top of the preset. */
  customPatterns?: Array<{ name: string; regex: RegExp; replace?: (m: string) => string }>;
  /** Extra object-key names whose values are redacted wholesale. */
  redactKeys?: string[];
  /** Key names to never touch (takes precedence over everything). */
  allowKeys?: string[];
  /** Full escape hatch. Return a replacement, or `undefined` to fall through to defaults. */
  redactor?: (value: unknown, key: string | null) => unknown;
  /** Called once per event with how many values were redacted. */
  onRedact?: (info: { redactions: number }) => void;
  /** Max recursion depth (cycle/blowup guard). */
  maxDepth?: number;
  /** Max characters kept per string field before it's truncated with a
   *  marker — a size guard against one huge tool output or pasted document
   *  bloating every ingest payload, independent of redaction. Applied BEFORE
   *  redaction's own regex passes run, so a huge field can't also make
   *  redaction itself slow (a long run of base64-alphabet characters can
   *  make the base64-candidate scan pathologically slow — measured 3+
   *  seconds on a single 60,000-char field pre-truncation). Default 50,000
   *  (~50KB) — generous for real content, small next to what an unbounded
   *  blob could be. */
  maxStringLength?: number;
}

/** One redaction — never the matched value itself, only what kind and where. */
export interface RedactionLogEntry {
  /** Rule/pattern name (e.g. "email", "ssn"), or "key:<name>" for a whole-value key match. */
  rule: string;
  /** JSON path where it occurred, e.g. "request.messages[0].content" — null at the root. */
  path: string | null;
  ts: string;
}

export interface Redactor {
  /** Redact an arbitrary JSON value. */
  redactValue(value: unknown): unknown;
  /** Redact the content-bearing fields of a trace event; envelope/metrics preserved. */
  redactEvent(event: TraceEvent): TraceEvent;
  /** Total values redacted across this redactor's lifetime. */
  total(): number;
  /** Itemized log of redactions across this redactor's lifetime, capped at 500 entries. */
  log(): RedactionLogEntry[];
  /** True once the log hit its cap — total() stays accurate even after this. */
  logTruncated(): boolean;
  /** How many string fields have been size-truncated (maxStringLength) across this redactor's lifetime — independent of redaction count. */
  truncatedFields(): number;
}

type Normalized = boolean | RedactionTier | RedactOptions | undefined;

/** Accepts `true`/`'standard'`/`'strict'`/options object/`false`. Returns null to disable. */
export function createRedactor(input?: Normalized): Redactor | null {
  if (input === false || input === undefined) return null;
  const opts: RedactOptions =
    input === true ? {} : typeof input === "string" ? { preset: input } : input;

  const tier = opts.preset ?? "standard";
  const baseRules = (opts.rules ?? RULES).filter(
    (r) => tier === "strict" || r.tier === "standard"
  );
  const customRules: RedactionRule[] = (opts.customPatterns ?? []).map((p) => ({
    name: p.name,
    regex: p.regex,
    tier: "standard",
    replace: p.replace,
  }));
  const activeRules = [...baseRules, ...customRules];

  const sensitive = new Set(
    [...SENSITIVE_KEYS, ...(opts.redactKeys ?? [])].map((k) => k.toLowerCase())
  );
  const allow = new Set((opts.allowKeys ?? []).map((k) => k.toLowerCase()));
  const maxDepth = opts.maxDepth ?? 24;
  const maxStringLength = opts.maxStringLength ?? 50_000;
  let lifetime = 0;
  let fieldsTruncated = 0;
  const MAX_LOG = 500;
  const redactionLog: RedactionLogEntry[] = [];
  let truncated = false;

  function record(rule: string, path: string | null) {
    if (redactionLog.length < MAX_LOG) redactionLog.push({ rule, path, ts: new Date().toISOString() });
    else truncated = true;
  }

  /** Size guard, independent of redaction — see RedactOptions.maxStringLength.
   *  Deliberately NOT recorded into the redaction log/total(): a truncated
   *  field wasn't found sensitive, and folding it into "N values redacted"
   *  would misrepresent why it changed to anyone reading that count. */
  function capLength(s: string, _path: string | null): string {
    if (s.length <= maxStringLength) return s;
    fieldsTruncated++;
    const overBy = s.length - maxStringLength;
    return `${s.slice(0, maxStringLength)}…[truncated: ${overBy} more chars]`;
  }

  function redactString(s: string, counter: { n: number }, path: string | null): string {
    let out = s;
    for (const rule of activeRules) {
      const { out: next, count } = applyRule(rule, out, () => record(rule.name, path));
      out = next;
      counter.n += count;
    }
    return redactBase64Secrets(out, counter, path);
  }

  /**
   * A secret pasted through base64 doesn't match any plaintext rule above —
   * the encoded text just doesn't look like an API key or a JWT. This finds
   * base64-shaped substrings, decodes each, and re-checks the DECODED text
   * against every active rule; a real hit redacts the original encoded
   * substring wholesale. Legitimate base64 (an image blob, a content hash)
   * decodes to bytes that don't match anything and is left untouched.
   */
  function redactBase64Secrets(s: string, counter: { n: number }, path: string | null): string {
    return s.replace(BASE64_CANDIDATE, (candidate) => {
      const decoded = decodeBase64Utf8(candidate);
      if (decoded == null) return candidate;
      for (const rule of activeRules) {
        const { count } = applyRule(rule, decoded);
        if (count > 0) {
          counter.n++;
          record(`base64:${rule.name}`, path);
          return "[redacted:base64]";
        }
      }
      return candidate;
    });
  }

  function walk(
    value: unknown,
    key: string | null,
    depth: number,
    seen: WeakSet<object>,
    counter: { n: number },
    path: string | null
  ): unknown {
    // custom escape hatch first
    if (opts.redactor) {
      const r = opts.redactor(value, key);
      if (r !== undefined) {
        if (r !== value) { counter.n++; record("custom", path); }
        return r;
      }
    }

    if (key !== null) {
      const lk = key.toLowerCase();
      if (allow.has(lk)) return value;
      if (sensitive.has(lk) && value != null) {
        counter.n++;
        record(`key:${key}`, path);
        return `[redacted:key:${key}]`;
      }
    }

    if (value == null) return value;
    // Cap BEFORE redacting, not after: redaction runs several regex passes
    // (including a base64-candidate scan) over the whole string, and a long
    // run of a base64-alphabet character can make that scan pathologically
    // slow — measured 3+ seconds on a single 60,000-char field. Truncating
    // first bounds redaction's own cost to at most maxStringLength, and
    // whatever gets cut is never sent anywhere, so there's no leak risk in
    // skipping it.
    if (typeof value === "string") return redactString(capLength(value, path), counter, path);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (depth >= maxDepth) return value;

    if (Array.isArray(value)) {
      if (seen.has(value)) return value;
      seen.add(value);
      return value.map((v, i) => walk(v, null, depth + 1, seen, counter, `${path ?? ""}[${i}]`));
    }
    if (typeof value === "object") {
      if (seen.has(value as object)) return value;
      seen.add(value as object);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v, k, depth + 1, seen, counter, path ? `${path}.${k}` : k);
      }
      return out;
    }
    return value;
  }

  function redactValue(value: unknown): unknown {
    const counter = { n: 0 };
    const out = walk(value, null, 0, new WeakSet(), counter, null);
    lifetime += counter.n;
    return out;
  }

  function redactEvent(event: TraceEvent): TraceEvent {
    const counter = { n: 0 };
    const seen = new WeakSet<object>();
    const w = (v: unknown, k: string | null = null, path: string | null = k) => walk(v, k, 0, seen, counter, path);

    // Default to the event itself: a type with no case below is returned as-is,
    // never silently dropped. (The `env` case was once missing, which dropped env
    // events whenever redaction was on — this is the runtime guard against a repeat.)
    let out: TraceEvent = event;
    switch (event.type) {
      case "llm":
        out = {
          ...event,
          request: {
            ...event.request,
            system: event.request.system == null ? null : (w(event.request.system, "system", "request.system") as string),
            messages: w(event.request.messages, "messages", "request.messages") as typeof event.request.messages,
            tools: w(event.request.tools, "tools", "request.tools") as typeof event.request.tools,
          },
          response: {
            ...event.response,
            text: event.response.text == null ? null : (w(event.response.text, "text", "response.text") as string),
            reasoning:
              event.response.reasoning == null ? null : (w(event.response.reasoning, "reasoning", "response.reasoning") as string),
            tool_calls: w(event.response.tool_calls, "tool_calls", "response.tool_calls") as typeof event.response.tool_calls,
          },
          error: event.error ? (w(event.error, "error") as typeof event.error) : null,
        };
        break;
      case "tool":
        out = {
          ...event,
          input: w(event.input, "input"),
          output: event.output == null ? null : w(event.output, "output"),
          error: event.error ? (w(event.error, "error") as typeof event.error) : null,
        };
        break;
      case "reasoning":
        out = { ...event, text: w(event.text, "text") as string };
        break;
      case "env":
        // Env reads are oracle entries too: a captured `fetch` output carries a
        // response body that can hold secrets/PII, so scrub it. Redaction runs
        // BEFORE the event is hash-chained (in the collector), so the recorded and
        // replayed values stay identical and the digest is computed over the
        // scrubbed value — consistent end to end. Primitive reads (now/random/
        // uuid/date) walk to themselves, leaving the digest untouched.
        out = { ...event, output: event.output == null ? null : w(event.output, "output") };
        break;
      case "run":
        out = {
          ...event,
          input: event.input == null ? null : w(event.input, "input"),
          output: event.output == null ? null : w(event.output, "output"),
          metadata: w(event.metadata, "metadata") as Record<string, unknown>,
          error: event.error ? (w(event.error, "error") as typeof event.error) : null,
        };
        break;
    }
    lifetime += counter.n;
    opts.onRedact?.({ redactions: counter.n });
    return out;
  }

  return {
    redactValue,
    redactEvent,
    total: () => lifetime,
    log: () => redactionLog,
    logTruncated: () => truncated,
    truncatedFields: () => fieldsTruncated,
  };
}
