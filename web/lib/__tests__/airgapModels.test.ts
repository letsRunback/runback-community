/**
 * An air-gapped deployment must be able to reach its own models.
 *
 * Every model-touching capability in the product — step replay, whole-run
 * replay, evals, golden suites, model diff/bisect, the prompt playground,
 * judge calibration — routes through `resolveModel`. Before this, that function
 * could only ever build a client against api.openai.com, api.anthropic.com or
 * api.groq.com, and the route in front of it validated model ids against a list
 * compiled at build time.
 *
 * On a site with no egress that is not a degraded experience, it is a dead
 * feature set with no configuration path — and the failure surfaces as a DNS
 * error at replay time, long after purchase.
 *
 * Two properties are load-bearing and tested here:
 *   1. The endpoint is configurable, and a missing key stops being fatal once
 *      it is, because self-hosted inference commonly takes no auth.
 *   2. The allowlist stays operator-controlled. It is a security control — an
 *      arbitrary model string is forwarded to a provider SDK and billed — so
 *      it must be extensible from the environment and never from a request.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveModel, providerBaseUrl, replayModelAllowlist, REPLAY_MODELS } from "@/lib/replay/runStep";

const VARS = [
  "RUNBACK_OPENAI_BASE_URL", "RUNBACK_ANTHROPIC_BASE_URL", "RUNBACK_GROQ_BASE_URL",
  "RUNBACK_EXTRA_REPLAY_MODELS", "RUNBACK_REPLAY_MODELS", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v]; } });
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe("provider base URL", () => {
  it("is undefined when unset, so the hosted service is unaffected", () => {
    expect(providerBaseUrl("openai")).toBeUndefined();
  });

  it("is returned when set to an internal endpoint", () => {
    process.env.RUNBACK_OPENAI_BASE_URL = "http://vllm.internal:8000/v1";
    expect(providerBaseUrl("openai")).toBe("http://vllm.internal:8000/v1");
  });

  it("rejects a non-URL loudly instead of falling back to the public API", () => {
    // Silently ignoring a typo would send an air-gapped deployment's traffic at
    // api.openai.com — the one outcome the setting exists to prevent.
    // Note: URL() parses this as scheme "vllm.internal:" rather than failing,
    // so it is the scheme check that catches a missing http://.
    process.env.RUNBACK_OPENAI_BASE_URL = "vllm.internal:8000";
    expect(() => providerBaseUrl("openai")).toThrow(/Include the scheme/);
  });

  it("rejects genuinely unparseable input", () => {
    process.env.RUNBACK_OPENAI_BASE_URL = "http://[";
    expect(() => providerBaseUrl("openai")).toThrow(/not a valid absolute URL/);
  });

  it("rejects a non-http scheme", () => {
    process.env.RUNBACK_OPENAI_BASE_URL = "file:///etc/passwd";
    expect(() => providerBaseUrl("openai")).toThrow(/must be http or https/);
  });
});

describe("resolveModel", () => {
  it("still refuses when there is neither a key nor an endpoint", () => {
    expect(() => resolveModel("gpt-4o", "openai")).toThrow(/No openai model key configured/);
  });

  it("builds a client with no key once an endpoint is configured", () => {
    // vLLM and Ollama accept unauthenticated requests. Demanding a key we would
    // only forward to an operator-chosen host blocks the air-gapped case and
    // buys nothing.
    process.env.RUNBACK_OPENAI_BASE_URL = "http://vllm.internal:8000/v1";
    expect(() => resolveModel("gpt-4o", "openai")).not.toThrow();
  });

  it("routes an operator-declared local model to the configured endpoint", () => {
    // Without this the id matches no built-in pattern and falls through to the
    // groq default — i.e. out to api.groq.com, which does not resolve here.
    // Qwen/Llama/Mixtral are the common self-hosted families AND they all match
    // the built-in Groq name pattern, so this asserts the operator check wins.
    process.env.RUNBACK_EXTRA_REPLAY_MODELS = "Qwen2.5-72B-Instruct";
    process.env.RUNBACK_OPENAI_BASE_URL = "http://vllm.internal:8000/v1";
    expect(() => resolveModel("Qwen2.5-72B-Instruct", "local")).not.toThrow();
  });
});

describe("replay allowlist", () => {
  it("is exactly the built-in list when nothing is declared", () => {
    expect(replayModelAllowlist()).toEqual([...REPLAY_MODELS]);
  });

  it("appends operator-declared models", () => {
    process.env.RUNBACK_EXTRA_REPLAY_MODELS = "mistral-7b-instruct, Qwen2.5-72B-Instruct";
    const all = replayModelAllowlist();
    expect(all).toContain("mistral-7b-instruct");
    expect(all).toContain("Qwen2.5-72B-Instruct");
    expect(all).toEqual(expect.arrayContaining([...REPLAY_MODELS]));
  });

  it("never drops a built-in model", () => {
    process.env.RUNBACK_EXTRA_REPLAY_MODELS = "local-only";
    for (const m of REPLAY_MODELS) expect(replayModelAllowlist()).toContain(m);
  });

  it("REPLAY_MODELS replaces the list outright, dropping the built-ins", () => {
    // Appending is wrong for an air-gap: every built-in is an unreachable
    // option, and the first one is the default selection.
    process.env.RUNBACK_REPLAY_MODELS = "Qwen2.5-72B-Instruct, mistral-7b";
    expect(replayModelAllowlist()).toEqual(["Qwen2.5-72B-Instruct", "mistral-7b"]);
    for (const m of REPLAY_MODELS) expect(replayModelAllowlist()).not.toContain(m);
  });

  it("REPLAY_MODELS wins over EXTRA when both are set", () => {
    process.env.RUNBACK_REPLAY_MODELS = "only-this";
    process.env.RUNBACK_EXTRA_REPLAY_MODELS = "and-this";
    expect(replayModelAllowlist()).toEqual(["only-this"]);
  });

  it("routes a replaced model that shares a built-in name to the local endpoint", () => {
    // A site serving its own llama-3.3-70b-versatile must not have replays sent
    // to api.groq.com just because the name matches a built-in pattern.
    process.env.RUNBACK_REPLAY_MODELS = "llama-3.3-70b-versatile";
    process.env.RUNBACK_OPENAI_BASE_URL = "http://vllm.internal:8000/v1";
    expect(() => resolveModel("llama-3.3-70b-versatile", "groq")).not.toThrow();
  });

  it("ignores blanks rather than allowing an empty model id", () => {
    // "a,,b" must not admit "" — an empty id would pass `includes("")` checks
    // for a caller sending no model at all.
    process.env.RUNBACK_EXTRA_REPLAY_MODELS = "a,,  ,b";
    expect(replayModelAllowlist()).not.toContain("");
    expect(replayModelAllowlist()).toContain("a");
    expect(replayModelAllowlist()).toContain("b");
  });
});
