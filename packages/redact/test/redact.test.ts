import { describe, it, expect } from "vitest";
import { createRedactor } from "../src/index";
import type { LlmEvent } from "@runback/schema";

const r = () => createRedactor("standard")!;
const strict = () => createRedactor("strict")!;

describe("secret & PII detectors (standard)", () => {
  const cases: [string, string, string][] = [
    ["email", "ping me at jane.doe@acme.co please", "email"],
    ["openai_key", "key=sk-proj-abc123def456ghi789jkl012", "openai_key"],
    ["anthropic_key", "sk-ant-api03-abc123def456ghi789jkl012mno", "anthropic_key"],
    ["groq_key", "gsk_0GSAAh4qypNTnJBjcatHWGdyb3FYAbCdEf", "groq_key"],
    ["github_token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github_token"],
    ["slack_token", "xoxb-1234567890-abcdefghij", "slack_token"],
    ["google_api_key", "AIzaSyA1234567890abcdefghijklmnopqrstuv", "google_api_key"],
    ["stripe_key", "sk_live_abcdefghijklmnop1234", "stripe_key"],
    ["aws_access_key", "AKIAIOSFODNN7EXAMPLE", "aws_access_key"],
    ["ssn", "ssn 123-45-6789 on file", "ssn"],
    ["jwt", "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.abcDEF123456", "jwt"],
  ];
  for (const [label, input, tag] of cases) {
    it(`redacts ${label}`, () => {
      const out = r().redactValue(input) as string;
      expect(out).toContain(`[redacted:${tag}]`);
      // the original secret must be gone
      const secret = input.split(/\s+/).find((w) => w.length > 12) ?? "";
      if (secret) expect(out).not.toContain(secret);
    });
  }

  it("still redacts an email with a long local part, at and just under the RFC 5321 64-char limit the bounded regex now enforces", () => {
    const local64 = "a".repeat(64);
    const out = r().redactValue(`contact ${local64}@example.com now`) as string;
    expect(out).toContain("[redacted:email]");
    expect(out).not.toContain(local64);
  });

  it("redacts a Bearer token but keeps the scheme", () => {
    const out = r().redactValue("authorization: Bearer abcdef0123456789xyz") as string;
    expect(out).toContain("Bearer [redacted]");
    expect(out).not.toContain("abcdef0123456789xyz");
  });

  it("redacts a private key block", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBVAIBADANB\nkqhki==\n-----END RSA PRIVATE KEY-----";
    const out = r().redactValue(pem) as string;
    expect(out).toBe("[redacted:private_key]");
  });

  it("redacts a Luhn-valid card but leaves an invalid one", () => {
    expect(r().redactValue("card 4111 1111 1111 1111")).toContain("[redacted:credit_card]");
    expect(r().redactValue("order 4111 1111 1111 1112")).toContain("4111 1111 1111 1112");
  });
});

describe("tiers", () => {
  it("standard leaves phone & IP; strict redacts them", () => {
    expect(r().redactValue("call 415-555-0142")).toContain("415-555-0142");
    expect(strict().redactValue("call 415-555-0142")).toContain("[redacted:phone]");
    expect(r().redactValue("host 10.0.0.42")).toContain("10.0.0.42");
    expect(strict().redactValue("host 10.0.0.42")).toContain("[redacted:ipv4]");
  });

  it("off returns a no-op redactor", () => {
    expect(createRedactor(false)).toBeNull();
    expect(createRedactor(undefined)).toBeNull();
  });
});

describe("key-name redaction", () => {
  it("redacts values of sensitive keys wholesale", () => {
    const out = r().redactValue({ password: "hunter2", note: "fine" }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted:key:password]");
    expect(out.note).toBe("fine");
  });

  it("walks nested objects and arrays", () => {
    const out = r().redactValue({
      user: { email: "a@b.com", profile: { ssn: "123-45-6789" } },
      items: [{ api_key: "secret123" }, { ok: 1 }],
    }) as any;
    expect(out.user.email).toContain("[redacted:email]");
    expect(out.user.profile.ssn).toContain("[redacted:key:ssn]");
    expect(out.items[0].api_key).toBe("[redacted:key:api_key]");
    expect(out.items[1].ok).toBe(1);
  });

  it("allowKeys protects a field", () => {
    const red = createRedactor({ preset: "standard", allowKeys: ["token"] })!;
    const out = red.redactValue({ token: "keepme", password: "x" }) as any;
    expect(out.token).toBe("keepme");
    expect(out.password).toBe("[redacted:key:password]");
  });

  it("survives cycles without throwing", () => {
    const a: any = { email: "x@y.com" };
    a.self = a;
    expect(() => r().redactValue(a)).not.toThrow();
  });
});

describe("custom patterns & callbacks", () => {
  it("applies a custom pattern", () => {
    const red = createRedactor({
      preset: "standard",
      customPatterns: [{ name: "emp_id", regex: /EMP-\d{5}/g }],
    })!;
    expect(red.redactValue("badge EMP-12345")).toContain("[redacted:emp_id]");
  });

  it("custom redactor hook takes precedence", () => {
    const red = createRedactor({
      redactor: (v) => (v === "MAGIC" ? "POOF" : undefined),
    })!;
    const out = red.redactValue({ a: "MAGIC", b: "n@m.com" }) as any;
    expect(out.a).toBe("POOF");
    expect(out.b).toContain("[redacted:email]"); // defaults still run elsewhere
  });
});

describe("redactEvent", () => {
  const base: LlmEvent = {
    schema_version: 1,
    run_id: "run1",
    span_id: "span1",
    parent_span_id: "root",
    seq: 3,
    ts_start: "2026-01-01T00:00:00.000Z",
    ts_end: "2026-01-01T00:00:01.000Z",
    type: "llm",
    model: { provider: "groq", model_id: "gpt-oss-120b" },
    request: {
      system: "Email the user at admin@corp.com",
      messages: [{ role: "user", content: "my ssn is 123-45-6789" }],
      tools: [],
      params: { temperature: 0.7 },
    },
    response: {
      text: "sent to admin@corp.com",
      reasoning: null,
      finish_reason: "stop",
      tool_calls: [],
    },
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    latency_ms: 1000,
    error: null,
  };

  it("scrubs content but preserves the envelope & metrics", () => {
    const out = r().redactEvent(base) as LlmEvent;
    // content redacted
    expect(out.request.system).toContain("[redacted:email]");
    expect(JSON.stringify(out.request.messages)).toContain("[redacted:ssn]");
    expect(out.response.text).toContain("[redacted:email]");
    // envelope & metrics intact (needed for monitor/eval)
    expect(out.span_id).toBe("span1");
    expect(out.parent_span_id).toBe("root");
    expect(out.seq).toBe(3);
    expect(out.model.model_id).toBe("gpt-oss-120b");
    expect(out.usage?.total_tokens).toBe(15);
    expect(out.latency_ms).toBe(1000);
    expect(out.response.finish_reason).toBe("stop");
  });

  it("counts redactions for the trust log", () => {
    const red = r();
    red.redactEvent(base);
    expect(red.total()).toBeGreaterThanOrEqual(3);
  });

  it("redacts env events instead of dropping them (Seam A: byte-exact capture survives redaction)", () => {
    const fetchEnv = {
      schema_version: 1,
      run_id: "run1",
      span_id: "envspan",
      parent_span_id: "root",
      seq: 7,
      ts_start: "2026-01-01T00:00:00.000Z",
      ts_end: null,
      type: "env",
      kind: "fetch",
      key: "sha256hash",
      output: { status: 200, statusText: "OK", bodyText: "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = r().redactEvent(fetchEnv);
    // The event MUST come back (a missing env case used to leave it undefined →
    // silently dropped in the collector → broken byte-exact capture).
    expect(out).toBeDefined();
    expect(out.type).toBe("env");
    expect(out.span_id).toBe("envspan");
    expect(out.seq).toBe(7);
    // The captured response body is scrubbed; the address/kind envelope is intact.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = out as any;
    expect(o.kind).toBe("fetch");
    expect(o.key).toBe("sha256hash");
    expect(JSON.stringify(o.output)).toContain("[redacted:github_token]");
    expect(JSON.stringify(o.output)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(o.output.status).toBe(200);
  });

  it("leaves a primitive env read (random) byte-identical — digest stays stable under redaction", () => {
    const randEnv = {
      schema_version: 1, run_id: "run1", span_id: "s", parent_span_id: null, seq: 1,
      ts_start: "2026-01-01T00:00:00.000Z", ts_end: null, type: "env", kind: "random", key: "random", output: 0.4242,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = r().redactEvent(randEnv);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((out as any).output).toBe(0.4242);
  });
});

describe("size guard — maxStringLength (independent of redaction)", () => {
  const bigEvent: LlmEvent = {
    schema_version: 1,
    run_id: "run1",
    span_id: "span1",
    parent_span_id: "root",
    seq: 3,
    ts_start: "2026-01-01T00:00:00.000Z",
    ts_end: "2026-01-01T00:00:01.000Z",
    type: "llm",
    model: { provider: "groq", model_id: "gpt-oss-120b" },
    request: {
      system: null,
      messages: [{ role: "user", content: "x".repeat(60_000) }],
      tools: [],
      params: {},
    },
    response: { text: "short reply", reasoning: null, finish_reason: "stop", tool_calls: [] },
    usage: null,
    latency_ms: 1000,
    error: null,
  };

  it("leaves a short field untouched", () => {
    const out = r().redactEvent(bigEvent) as LlmEvent;
    expect(out.response.text).toBe("short reply");
  });

  it("truncates a field over the default 50,000-char cap and marks it", () => {
    const red = r();
    const out = red.redactEvent(bigEvent) as LlmEvent;
    const content = out.request.messages[0].content as string;
    expect(content.length).toBeLessThan(60_000);
    expect(content).toContain("…[truncated:");
    expect(red.truncatedFields()).toBe(1);
  });

  it("does not count a size truncation as a redaction", () => {
    const red = r();
    red.redactEvent(bigEvent);
    expect(red.total()).toBe(0);
    expect(red.truncatedFields()).toBe(1);
  });

  it("respects a custom maxStringLength", () => {
    const red = createRedactor({ preset: "standard", maxStringLength: 100 })!;
    const out = red.redactEvent(bigEvent) as LlmEvent;
    const content = out.request.messages[0].content as string;
    expect(content.length).toBeLessThan(150);
    expect(red.truncatedFields()).toBe(1);
  });

  it("redacts a large field with no email in it in well under a second — regression for a real O(n²) bug in the old unbounded email regex", () => {
    // The unbounded `[A-Za-z0-9._%+-]+@...` local-part measured 2.4+ seconds
    // on a single 50,000-char field with no '@' at all — every large
    // tool-output/JSON blob with no email in it, which is the common case.
    const noEmail: LlmEvent = {
      ...bigEvent,
      request: { ...bigEvent.request, messages: [{ role: "user", content: "x".repeat(50_000) }] },
    };
    const start = Date.now();
    r().redactEvent(noEmail);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("still redacts a secret inside an oversized field before truncating the output", () => {
    const withSecret: LlmEvent = {
      ...bigEvent,
      request: {
        ...bigEvent.request,
        messages: [{ role: "user", content: `sk-ant-abcdefghijklmnopqrstuvwx ${"x".repeat(60_000)}` }],
      },
    };
    const out = r().redactEvent(withSecret) as LlmEvent;
    const content = out.request.messages[0].content as string;
    expect(content).toContain("[redacted:anthropic_key]");
    expect(content).not.toContain("sk-ant-abcdefghijklmnopqrstuvwx");
  });
});
