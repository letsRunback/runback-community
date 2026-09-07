import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Collector } from "../src/collector";
import { cassetteDigestFromEvents } from "@runback/replay";
import type { TraceEvent } from "@runback/schema";

/**
 * Fusion glue, end to end (Seam A): the digest the SDK computes at capture time
 * must equal the digest the server recomputes from the events that actually went
 * over the wire — INCLUDING environment reads. This is the whole determinism
 * guarantee: a third party recomputing the chain from stored events lands on the
 * exact value the agent attested. We prove it across the real emission path
 * (record → buffer → flush) by capturing the ingest batches.
 */
describe("fusion glue — capture-time digest == server digest, WITH env", () => {
  const realFetch = globalThis.fetch;
  let sent: TraceEvent[] = [];

  beforeEach(() => {
    sent = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      sent.push(...JSON.parse(init.body).events);
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("an env-capturing run: the SDK's capture-time digest equals cassetteDigestFromEvents over the emitted events", async () => {
    const c = new Collector({ runName: "envrun", apiKey: "test-key" });
    c.recordLlm({
      ts_start: "2026-01-01T00:00:00.000Z",
      ts_end: "2026-01-01T00:00:00.000Z",
      model: { provider: "openai", model_id: "gpt-4o" },
      request: { system: null, messages: [{ role: "user", content: "hi" }], tools: [], params: {} },
      response: { text: null, reasoning: null, finish_reason: "tool-call", tool_calls: [{ tool_call_id: "a", tool_name: "search", input: { q: "x" } }] },
      usage: null,
      latency_ms: 1,
      error: null,
    } as unknown as Parameters<Collector["recordLlm"]>[0]);
    c.recordEnv("now", "now", 1700000000000);
    c.recordEnv("random", "random", 0.42);
    c.recordTool({ tool_name: "search", tool_call_id: "a", input: { q: "x" }, output: { hits: 3 }, latency_ms: 1, error: null, ts_start: "2026-01-01T00:00:00.000Z" });

    const capture = c.cassetteDigest();
    await c.finish({ output: "done", status: "success" });

    // 1. Env reads really left the process (capture isn't blind to nondeterminism).
    expect(sent.some((e) => e.type === "env" && e.kind === "now")).toBe(true);
    expect(sent.some((e) => e.type === "env" && e.kind === "random")).toBe(true);

    // 2. The server-side digest over the wire events equals the capture-time digest.
    const server = cassetteDigestFromEvents(sent);
    expect(server.digest).toBe(capture.digest);

    // 3. It chained exactly llm + 2 env + tool = 4 entries (envelopes excluded).
    expect(server.entry_count).toBe(4);
    expect(capture.entry_count).toBe(4);

    // 4. The run-end envelope carries the same digest the server recomputes.
    const end = sent.find((e) => e.type === "run" && e.phase === "end");
    expect((end as { metadata: { cassette_digest: string } }).metadata.cassette_digest).toBe(server.digest);
  });

  it("with redaction ON: env reads still reach the wire and the digest parity holds", async () => {
    // The production setting. A missing redact `env` case used to drop env events
    // silently in the collector — breaking byte-exact capture exactly when a
    // customer turned on redaction. This proves they survive and stay consistent.
    const c = new Collector({ runName: "redacted-envrun", apiKey: "test-key", redact: "standard" });
    c.recordEnv("now", "now", 1700000000000);
    c.recordEnv("random", "random", 0.42);
    const capture = c.cassetteDigest();
    await c.finish({ output: "done", status: "success" });

    const envOnWire = sent.filter((e) => e.type === "env");
    expect(envOnWire.length).toBe(2); // not dropped
    expect(cassetteDigestFromEvents(sent).digest).toBe(capture.digest);
    expect(capture.entry_count).toBe(2);
  });

  it("an altered env value on the wire no longer matches the attested digest", async () => {
    const c = new Collector({ runName: "envrun2", apiKey: "test-key" });
    c.recordEnv("random", "random", 0.42);
    const attested = c.cassetteDigest().digest;
    await c.finish({ output: "done", status: "success" });

    const tampered = sent.map((e) =>
      e.type === "env" && e.kind === "random" ? { ...e, output: 0.999 } : e
    );
    expect(cassetteDigestFromEvents(tampered).digest).not.toBe(attested);
  });
});
