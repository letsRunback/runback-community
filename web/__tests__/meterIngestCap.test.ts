import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TraceEvent } from "@runback/schema";

/**
 * meterIngest() used to read usage_counters, compare against the plan cap in
 * application code, and only THEN call bump_usage — a read-then-write with no
 * lock between the two round trips. Two concurrent requests near the ceiling
 * could both pass that check and both commit, overshooting the cap. It's now
 * a single atomic bump_usage_capped() RPC call (see sql/add_bump_usage_capped.sql).
 * These tests exercise meterIngest()'s handling of that RPC's result — the
 * genuine per-request concurrency behavior lives in Postgres row locking
 * (FOR UPDATE), which a unit test against a mocked client can't exercise, but
 * the contract meterIngest relies on (single atomic call, fail-closed on
 * error) is fully under test here.
 */

let rpcResult: { data: unknown; error: { message: string } | null };
const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      const self = () => c;
      c.select = self;
      c.eq = self;
      c.in = self;
      c.limit = self;
      c.maybeSingle = () => {
        if (table === "orgs") return Promise.resolve({ data: { plan: "free", trial_ends_at: null } });
        if (table === "usage_counters") return Promise.resolve({ data: { runs: 0 } });
        return Promise.resolve({ data: null });
      };
      c.then = (resolve: (v: unknown) => void) => {
        // ad_runs "which run ids already exist" check — none exist (all new).
        resolve({ data: [] });
      };
      return c;
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return { single: () => Promise.resolve(rpcResult) };
    },
  }),
}));

const runStart = (runId: string): TraceEvent =>
  ({ type: "run", phase: "start", run_id: runId } as unknown as TraceEvent);

describe("meterIngest — atomic cap check via bump_usage_capped", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
  });

  it("allowed: true when the RPC reports the increment fit under the cap", async () => {
    rpcResult = { data: { allowed: true, runs: 501 }, error: null };
    const { meterIngest } = await import("../lib/usage");
    const result = await meterIngest("org1", [runStart("r1")]);
    expect(result).toEqual({ allowed: true, newRuns: 1, runs: 501, limit: 1000 });
    expect(rpcCalls).toEqual([
      { name: "bump_usage_capped", params: { p_org: "org1", p_period: expect.any(String), p_n: 1, p_limit: 1000 } },
    ]);
  });

  it("allowed: false when the RPC reports the increment would exceed the cap — the atomic decision wins, not a stale local read", async () => {
    rpcResult = { data: { allowed: false, runs: 1000 }, error: null };
    const { meterIngest } = await import("../lib/usage");
    const result = await meterIngest("org1", [runStart("r1")]);
    expect(result.allowed).toBe(false);
    expect(result.runs).toBe(1000);
  });

  it("fails CLOSED (not open) when the RPC call itself errors — a metering outage must not silently let over-cap ingest through", async () => {
    rpcResult = { data: null, error: { message: "connection reset" } };
    const { meterIngest } = await import("../lib/usage");
    const result = await meterIngest("org1", [runStart("r1")]);
    expect(result.allowed).toBe(false);
  });

  it("never calls the RPC at all when there are no new run-starts to count", async () => {
    const { meterIngest } = await import("../lib/usage");
    await meterIngest("org1", []);
    expect(rpcCalls).toEqual([]);
  });
});
