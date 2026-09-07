import { describe, it, expect, vi, afterEach } from "vitest";
import { Collector } from "../src/collector";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

function fakeAuthFetch(response: { revoked: boolean; reason?: string | null } | "error", calls: string[] = []) {
  return vi.fn(async (url: unknown) => {
    calls.push(String(url));
    if (response === "error") throw new Error("network down");
    return { ok: true, json: async () => response } as Response;
  }) as unknown as typeof fetch;
}

describe("Collector guard (Feature #5 kill-switch)", () => {
  it("does nothing when guard is not set — no fetch, never blocks", async () => {
    const calls: string[] = [];
    globalThis.fetch = fakeAuthFetch({ revoked: true }, calls);
    const c = new Collector({ runName: "t", apiKey: "rb_test" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(0);
    expect(c.enforceToolCall("issue_refund", { amount: 9999 }).allowed).toBe(true);
    await c.finish({ status: "success" }).catch(() => null);
  });

  it("blocks and records a re-runnable event once the poll reports revoked", async () => {
    globalThis.fetch = fakeAuthFetch({ revoked: true, reason: "Drift severity critical" });
    const c = new Collector({ runName: "loan-agent", apiKey: "rb_test", guard: true });
    // The constructor's poll() is fire-and-forget — flush a microtask so it resolves.
    await new Promise((r) => setTimeout(r, 0));

    const before = c.cassetteDigest();
    const decision = c.enforceToolCall("issue_refund", { amount: 500 });
    expect(decision.allowed).toBe(false);
    expect(decision.rule).toBe("authorization_revoked");
    expect(decision.detail).toBe("Drift severity critical");
    // Recorded as a real event, same as a local policy block.
    const after = c.cassetteDigest();
    expect(after.entry_count).toBeGreaterThan(before.entry_count);

    await c.finish({ status: "success" }).catch(() => null);
  });

  it("polls the agent_name query param — defaults to runName, honors an override", async () => {
    const calls: string[] = [];
    globalThis.fetch = fakeAuthFetch({ revoked: false }, calls);
    const c1 = new Collector({ runName: "loan-agent", apiKey: "rb_test", guard: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]).toContain("agent_name=loan-agent");
    await c1.finish({ status: "success" }).catch(() => null);

    const c2 = new Collector({ runName: "loan-agent", apiKey: "rb_test", guard: { agentName: "loan-orchestrator" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((u) => u.includes("agent_name=loan-orchestrator"))).toBe(true);
    await c2.finish({ status: "success" }).catch(() => null);
  });

  it("fails OPEN on a network error — never blocks because the guard endpoint is unreachable", async () => {
    globalThis.fetch = fakeAuthFetch("error");
    const c = new Collector({ runName: "t", apiKey: "rb_test", guard: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(c.enforceToolCall("issue_refund", { amount: 9999 }).allowed).toBe(true);
    await c.finish({ status: "success" }).catch(() => null);
  });

  it("fails OPEN with no apiKey configured — never polls, never blocks", async () => {
    const calls: string[] = [];
    globalThis.fetch = fakeAuthFetch({ revoked: true }, calls);
    const c = new Collector({ runName: "t", guard: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(0);
    expect(c.enforceToolCall("issue_refund", { amount: 9999 }).allowed).toBe(true);
    await c.finish({ status: "success" }).catch(() => null);
  });
});
