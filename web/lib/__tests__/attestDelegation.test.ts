/**
 * attestDelegation is the one place a delegation edge's scope becomes real
 * instead of hardcoded ["*"] — see lib/trust.ts. Pins:
 *  - a declared scope is persisted verbatim, not silently widened to "*"
 *  - depth and parent_token_hash chain correctly off the parent's own
 *    inbound edge, exactly as the removed deriveAndPersistChain did
 *  - a root delegation (parent has no inbound edge of its own) gets
 *    depth 0 and a null parent_token_hash
 *  - a missing parent or child run is a no-op, not a throw (ingest calls
 *    this fire-and-forget and must never fail the write path over it)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

const state: {
  runs: Record<string, { name: string; org_id: string }>;
  parentEdge: { delegation_depth: number; token: string } | null;
  upserts: Record<string, unknown>[];
} = { runs: {}, parentEdge: null, upserts: [] };

vi.mock("@/lib/supabase/admin", () => {
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self;
    api.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return api;
    };
    api.maybeSingle = async () => {
      if (table === "ad_runs") {
        const row = state.runs[filters.run_id as string];
        if (!row || row.org_id !== filters.org_id) return { data: null, error: null };
        return { data: { name: row.name }, error: null };
      }
      if (table === "trust_attestations") {
        return { data: state.parentEdge, error: null };
      }
      return { data: null, error: null };
    };
    api.upsert = (row: Record<string, unknown>) => {
      state.upserts.push(row);
      return Promise.resolve({ data: null, error: null });
    };
    return api;
  };
  return { getAdminClient: () => ({ from: (t: string) => builder(t) }) };
});

import { attestDelegation } from "@/lib/trust";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
beforeEach(() => {
  state.runs = {};
  state.parentEdge = null;
  state.upserts = [];
  process.env.AUDIT_SIGNING_KEY = "test-secret";
});

describe("attestDelegation", () => {
  it("persists the caller's real declared scope, not [*]", async () => {
    state.runs = {
      run_parent: { name: "orchestrator", org_id: "org_a" },
      run_child: { name: "subagent", org_id: "org_a" },
    };
    await attestDelegation("org_a", "run_parent", "run_child", ["fs:read", "http:get"]);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].scope).toEqual(["fs:read", "http:get"]);
  });

  it("gives a root delegation depth 0 and null parent_token_hash", async () => {
    state.runs = {
      run_parent: { name: "orchestrator", org_id: "org_a" },
      run_child: { name: "subagent", org_id: "org_a" },
    };
    state.parentEdge = null; // parent has no inbound edge of its own
    await attestDelegation("org_a", "run_parent", "run_child", ["*"]);
    expect(state.upserts[0].delegation_depth).toBe(0);
    expect(state.upserts[0].parent_token_hash).toBeNull();
  });

  it("chains depth and parent_token_hash off the parent's own inbound edge", async () => {
    state.runs = {
      run_child: { name: "subagent", org_id: "org_a" },
      run_grandchild: { name: "leaf-agent", org_id: "org_a" },
    };
    state.parentEdge = { delegation_depth: 1, token: "parent-signature-value" };
    await attestDelegation("org_a", "run_child", "run_grandchild", ["*"]);
    expect(state.upserts[0].delegation_depth).toBe(2);
    expect(state.upserts[0].parent_token_hash).toBe(
      createHash("sha256").update("parent-signature-value").digest("hex")
    );
  });

  it("is a no-op when the parent run doesn't exist or belongs to a different org", async () => {
    state.runs = { run_child: { name: "subagent", org_id: "org_a" } };
    await attestDelegation("org_a", "run_parent_missing", "run_child", ["*"]);
    expect(state.upserts).toHaveLength(0);
  });

  it("is a no-op when the child run doesn't exist", async () => {
    state.runs = { run_parent: { name: "orchestrator", org_id: "org_a" } };
    await attestDelegation("org_a", "run_parent", "run_child_missing", ["*"]);
    expect(state.upserts).toHaveLength(0);
  });
});
