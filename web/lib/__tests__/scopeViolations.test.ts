/**
 * scopeAllows/auditScopeViolations turn a delegation's declared scope from a
 * display-only field into something a real tool-call history can be checked
 * against. Pins:
 *  - "*" always matches; a trailing-wildcard namespace matches its prefix;
 *    anything else is an exact match
 *  - a fully-in-scope run is not flagged
 *  - an out-of-scope tool call is flagged, by name, and only once even if
 *    called repeatedly
 *  - wildcard-scope edges are skipped entirely (nothing to check)
 *  - a stale violation list is cleared once the run is back in scope
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { scopeAllows } from "@/lib/trust";

describe("scopeAllows", () => {
  it("* matches anything", () => {
    expect(scopeAllows(["*"], "shell.exec")).toBe(true);
  });
  it("a trailing-wildcard namespace matches its prefix only", () => {
    expect(scopeAllows(["fs:*"], "fs:read")).toBe(true);
    expect(scopeAllows(["fs:*"], "fs:write")).toBe(true);
    expect(scopeAllows(["fs:*"], "http:get")).toBe(false);
  });
  it("a bare pattern is an exact match", () => {
    expect(scopeAllows(["http:get"], "http:get")).toBe(true);
    expect(scopeAllows(["http:get"], "http:post")).toBe(false);
  });
  it("any matching pattern in the list is enough", () => {
    expect(scopeAllows(["fs:*", "http:get"], "http:get")).toBe(true);
    expect(scopeAllows(["fs:*", "http:get"], "shell.exec")).toBe(false);
  });
});

const state: {
  edges: { parent_run_id: string; child_run_id: string; scope: string[] }[];
  toolEvents: Record<string, { tool_name: string | null }[]>;
  updates: Record<string, unknown>[];
} = { edges: [], toolEvents: {}, updates: [] };

vi.mock("@/lib/supabase/admin", () => {
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    let updateRow: Record<string, unknown> | null = null;
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self;
    api.limit = self;
    api.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return api;
    };
    api.update = (row: Record<string, unknown>) => {
      updateRow = row;
      return api;
    };
    // Every chain resolves as a thenable, like the real client. Filters are
    // only fully populated once every .eq() in the chain has run, so read
    // them lazily here rather than capturing at .update()/.select() time.
    api.then = (resolve: (v: { data: unknown; error: null }) => void) => {
      if (updateRow) {
        state.updates.push({ ...filters, ...updateRow });
        resolve({ data: null, error: null });
      } else if (table === "trust_attestations") {
        resolve({ data: state.edges, error: null });
      } else if (table === "ad_events") {
        resolve({ data: state.toolEvents[filters.run_id as string] ?? [], error: null });
      } else {
        resolve({ data: null, error: null });
      }
      return Promise.resolve();
    };
    return api;
  };
  return { getAdminClient: () => ({ from: (t: string) => builder(t) }) };
});

import { auditScopeViolations } from "@/lib/trust";

beforeEach(() => {
  state.edges = [];
  state.toolEvents = {};
  state.updates = [];
});

describe("auditScopeViolations", () => {
  it("skips wildcard-scope edges entirely", async () => {
    state.edges = [{ parent_run_id: "p", child_run_id: "c", scope: ["*"] }];
    const result = await auditScopeViolations("org_a");
    expect(result).toEqual({ checked: 0, flagged: 0 });
    expect(state.updates).toHaveLength(0);
  });

  it("does not flag a run that stayed in scope", async () => {
    state.edges = [{ parent_run_id: "p", child_run_id: "c", scope: ["fs:*"] }];
    state.toolEvents.c = [{ tool_name: "fs:read" }, { tool_name: "fs:write" }];
    const result = await auditScopeViolations("org_a");
    expect(result).toEqual({ checked: 1, flagged: 0 });
    expect(state.updates[0].scope_violations).toEqual([]);
  });

  it("flags an out-of-scope tool call once, by name", async () => {
    state.edges = [{ parent_run_id: "p", child_run_id: "c", scope: ["fs:*"] }];
    state.toolEvents.c = [
      { tool_name: "fs:read" },
      { tool_name: "shell.exec" },
      { tool_name: "shell.exec" },
    ];
    const result = await auditScopeViolations("org_a");
    expect(result).toEqual({ checked: 1, flagged: 1 });
    expect(state.updates[0].scope_violations).toEqual(["shell.exec"]);
  });

  it("writes an empty list (clearing any stale violation) when back in scope", async () => {
    state.edges = [{ parent_run_id: "p", child_run_id: "c", scope: ["fs:*"] }];
    state.toolEvents.c = [{ tool_name: "fs:read" }];
    await auditScopeViolations("org_a");
    expect(state.updates[0]).toMatchObject({
      parent_run_id: "p",
      child_run_id: "c",
      scope_violations: [],
    });
  });
});
