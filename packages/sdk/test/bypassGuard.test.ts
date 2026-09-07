import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installBypassGuard, __resetForTests } from "../src/bypassGuard";
import { runInstrumented } from "../src/instrumentedMarker";

const REAL_FETCH = globalThis.fetch;

function fakeRealFetch(hits: string[]) {
  return vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    hits.push(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  __resetForTests();
  delete process.env.RUNBACK_API_KEY;
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  __resetForTests();
});

describe("bypassGuard", () => {
  it("does not flag a call made inside runInstrumented (the properly-wrapped path)", async () => {
    const hits: string[] = [];
    globalThis.fetch = fakeRealFetch(hits);
    const events: unknown[] = [];
    installBypassGuard({ onBypass: (e) => events.push(e) });

    await runInstrumented(() => fetch("https://api.openai.com/v1/chat/completions"));

    expect(hits).toEqual(["https://api.openai.com/v1/chat/completions"]);
    expect(events).toEqual([]);
  });

  it("flags a call to a provider hostname made OUTSIDE any instrumented context", async () => {
    const hits: string[] = [];
    globalThis.fetch = fakeRealFetch(hits);
    const events: { hostname: string }[] = [];
    installBypassGuard({ onBypass: (e) => events.push(e) });

    await fetch("https://api.openai.com/v1/chat/completions");

    expect(hits).toEqual(["https://api.openai.com/v1/chat/completions"]); // observe mode: real call still happens
    expect(events).toHaveLength(1);
    expect(events[0].hostname).toBe("api.openai.com");
  });

  it("does not flag a call to an unrelated hostname", async () => {
    const hits: string[] = [];
    globalThis.fetch = fakeRealFetch(hits);
    const events: unknown[] = [];
    installBypassGuard({ onBypass: (e) => events.push(e) });

    await fetch("https://example.com/webhook");

    expect(hits).toEqual(["https://example.com/webhook"]);
    expect(events).toEqual([]);
  });

  it("mode: block throws instead of allowing the call through", async () => {
    globalThis.fetch = fakeRealFetch([]);
    installBypassGuard({ mode: "block" });

    await expect(fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow(/Blocked an unwrapped call/);
  });

  it("matches a custom hostname list", async () => {
    const hits: string[] = [];
    globalThis.fetch = fakeRealFetch(hits);
    const events: { hostname: string }[] = [];
    installBypassGuard({ hostnames: ["my-internal-llm.corp.example"], onBypass: (e) => events.push(e) });

    // Not in the custom list -> unflagged even though it's a known public provider.
    await fetch("https://api.openai.com/v1/chat/completions");
    expect(events).toEqual([]);

    // In the custom list -> flagged.
    await fetch("https://my-internal-llm.corp.example/v1/generate");
    expect(events).toHaveLength(1);
    expect(events[0].hostname).toBe("my-internal-llm.corp.example");
  });

  it("strips query strings before reporting (some providers pass keys as query params)", async () => {
    globalThis.fetch = fakeRealFetch([]);
    const events: { url: string }[] = [];
    installBypassGuard({ onBypass: (e) => events.push(e) });

    await fetch("https://generativelanguage.googleapis.com/v1/models/gemini:generateContent?key=SECRET_KEY_VALUE");

    expect(events).toHaveLength(1);
    expect(events[0].url).not.toContain("SECRET_KEY_VALUE");
    expect(events[0].url).toBe("https://generativelanguage.googleapis.com/v1/models/gemini:generateContent");
  });

  it("is idempotent — installing twice does not double-wrap fetch", async () => {
    const hits: string[] = [];
    globalThis.fetch = fakeRealFetch(hits);
    const events: unknown[] = [];
    installBypassGuard({ onBypass: (e) => events.push(e) });
    installBypassGuard({ onBypass: (e) => events.push(e) }); // second call is a no-op — first installation wins

    await fetch("https://api.openai.com/v1/chat/completions");
    expect(events).toHaveLength(1); // not 2
  });
});
