/**
 * Fire a real replay at a real HTTP endpoint.
 *
 * Every other test in this suite stubs the provider SDKs, and the hosted demo
 * path simulates rather than calling out — so nothing proved that the wire
 * format runStep produces is one an OpenAI-compatible server actually accepts.
 * That gap became load-bearing twice over: the @ai-sdk provider packages were
 * bumped across a major (v2 → v3, for GHSA-866g-f22w-33x8), and air-gapped
 * deployments now point those same providers at their own endpoint.
 *
 * This starts a throwaway server on loopback that answers like OpenAI's
 * /v1/chat/completions, points RUNBACK_OPENAI_BASE_URL at it, and runs the real
 * runStep. No stubs, no network, no spend, no API key — which is also the exact
 * configuration an air-gapped site runs in.
 *
 * What it proves that a mocked test cannot: the SDK builds a request our mock
 * can parse, sends it to the configured base URL rather than api.openai.com,
 * and runStep reads a real response body back into a ReplayedOutput.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LlmEvent } from "@runback/schema";

let server: Server;
let baseUrl: string;
/** Every request body the fake provider received, for asserting what was sent. */
interface Received { url?: string; body: Record<string, unknown> | null; raw?: string }
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        received.push({ url: req.url, body: JSON.parse(body || "{}") });
      } catch {
        received.push({ url: req.url, body: null, raw: body });
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1,
          model: "gpt-4o",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ESCALATE: amount over threshold." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const VARS = ["RUNBACK_OPENAI_BASE_URL", "RUNBACK_REPLAY_MODELS", "OPENAI_API_KEY"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  received.length = 0;
  for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v]; }
  process.env.RUNBACK_OPENAI_BASE_URL = baseUrl;
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

const CAPTURED: Pick<LlmEvent, "request" | "model"> = {
  model: { provider: "openai", model_id: "gpt-4o" },
  request: {
    system: "You are a dispute triage agent.",
    messages: [{ role: "user", content: "Refund request for $4,200 on order 88213." }],
    tools: [],
    params: { temperature: 0 },
  },
};

describe("replay against a real OpenAI-compatible endpoint", () => {
  it("completes end to end with no API key and no egress", async () => {
    const { runStep } = await import("@/lib/replay/runStep");
    const result = await runStep({ request: CAPTURED.request, model: CAPTURED.model });

    expect(result.ok, `replay failed: ${result.error}`).toBe(true);
    expect(result.response?.text).toContain("ESCALATE");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("sent the request to the configured endpoint, not the public API", async () => {
    const { runStep } = await import("@/lib/replay/runStep");
    await runStep({ request: CAPTURED.request, model: CAPTURED.model });
    expect(received.length).toBe(1);
    expect(received[0].url).toContain("/chat/completions");
  });

  it("forwards the captured context window verbatim", async () => {
    // The captured request IS the product. If replay silently reshapes it, the
    // thing being replayed is not the thing that ran.
    const { runStep } = await import("@/lib/replay/runStep");
    await runStep({ request: CAPTURED.request, model: CAPTURED.model });

    const sent = received[0].body;
    const roles = ((sent?.messages ?? []) as { role: string }[]).map((m) => m.role);
    expect(roles).toContain("system");
    expect(roles).toContain("user");
    expect(JSON.stringify(sent)).toContain("4,200");
    expect(JSON.stringify(sent)).toContain("dispute triage");
  });

  it("replays on an operator-declared local model, not the captured one", async () => {
    // The regression that prompted this: runStep validated the override against
    // the build-time constant, so a declared model passed the route and was
    // then silently dropped here — replaying the captured model and reporting
    // success for a model the user never chose.
    process.env.RUNBACK_REPLAY_MODELS = "Qwen2.5-72B-Instruct";
    const { runStep } = await import("@/lib/replay/runStep");
    const result = await runStep({
      request: CAPTURED.request,
      model: CAPTURED.model,
      model_id: "Qwen2.5-72B-Instruct",
    });

    expect(result.ok, `replay failed: ${result.error}`).toBe(true);
    expect(received[0].body?.model).toBe("Qwen2.5-72B-Instruct");
    expect(result.model?.model_id).toBe("Qwen2.5-72B-Instruct");
  });
});
