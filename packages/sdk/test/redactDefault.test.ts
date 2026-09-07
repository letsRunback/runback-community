import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Collector } from "../src/collector";
import type { TraceEvent } from "@runback/schema";

/**
 * redact used to default OFF — the integration path an integrator reaches by
 * just calling withDebugger()/new Collector() with no redact option sent
 * secrets/PII unredacted, while /security described scrubbing as automatic
 * ("before a trace is sent anywhere"). Standard-tier redaction is now ON by
 * default; `redact: false` opts back out.
 */
describe("Collector — redaction defaults to ON", () => {
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

  it("with NO redact option set, a secret in a tool call is scrubbed before it reaches the wire", async () => {
    const c = new Collector({ runName: "t", apiKey: "test-key" }); // no `redact` passed at all
    c.recordTool({
      tool_name: "call_api",
      tool_call_id: "1",
      input: { authorization: "Bearer sk-live-abcdefghijklmnopqrstuvwx" },
      output: { ok: true },
      latency_ms: 1,
      error: null,
      ts_start: "2026-01-01T00:00:00.000Z",
    });
    await c.finish({ output: "done", status: "success" });

    const tool = sent.find((e) => e.type === "tool") as (TraceEvent & { input: { authorization: string } }) | undefined;
    expect(tool).toBeTruthy();
    expect(JSON.stringify(tool!.input)).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
  });

  it("redact: false explicitly opts out — the secret reaches the wire unredacted", async () => {
    const c = new Collector({ runName: "t", apiKey: "test-key", redact: false });
    c.recordTool({
      tool_name: "call_api",
      tool_call_id: "1",
      input: { authorization: "Bearer sk-live-abcdefghijklmnopqrstuvwx" },
      output: { ok: true },
      latency_ms: 1,
      error: null,
      ts_start: "2026-01-01T00:00:00.000Z",
    });
    await c.finish({ output: "done", status: "success" });

    const tool = sent.find((e) => e.type === "tool") as (TraceEvent & { input: { authorization: string } }) | undefined;
    expect(tool).toBeTruthy();
    expect(JSON.stringify(tool!.input)).toContain("sk-live-abcdefghijklmnopqrstuvwx");
  });

  it("caps an oversized field and reports it on the run-end envelope, not silently", async () => {
    const c = new Collector({ runName: "t", apiKey: "test-key" });
    c.recordTool({
      tool_name: "call_api",
      tool_call_id: "1",
      input: {},
      output: { blob: "y".repeat(60_000) },
      latency_ms: 1,
      error: null,
      ts_start: "2026-01-01T00:00:00.000Z",
    });
    await c.finish({ output: "done", status: "success" });

    const tool = sent.find((e) => e.type === "tool") as (TraceEvent & { output: { blob: string } }) | undefined;
    expect(tool!.output.blob.length).toBeLessThan(60_000);
    expect(tool!.output.blob).toContain("…[truncated:");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runEnd = sent.find((e) => e.type === "run" && (e as any).phase === "end") as any;
    expect(runEnd.metadata.truncated_fields).toBe(1);
  });

  it("explicit redact: 'strict' still works exactly as before (default doesn't override an explicit choice)", async () => {
    const c = new Collector({ runName: "t", apiKey: "test-key", redact: "strict" });
    c.recordTool({
      tool_name: "call_user",
      tool_call_id: "1",
      input: { phone: "+1-415-555-0199" },
      output: { ok: true },
      latency_ms: 1,
      error: null,
      ts_start: "2026-01-01T00:00:00.000Z",
    });
    await c.finish({ output: "done", status: "success" });
    const tool = sent.find((e) => e.type === "tool") as (TraceEvent & { input: { phone: string } }) | undefined;
    expect(JSON.stringify(tool!.input)).not.toContain("415-555-0199");
  });
});
