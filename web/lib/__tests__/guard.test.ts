/**
 * lib/guard.ts is the server-side half of Feature #5's kill-switch: read by
 * the status API the SDK polls, written by the adversarial-guard cron.
 * Pins the read/write shape and the "no row yet = not revoked" default.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: { rows: Record<string, { revoked: boolean; revoked_reason: string | null; revoked_at: string | null }> } = { rows: {} };

vi.mock("@/lib/supabase/admin", () => {
  const builder = () => {
    const filters: Record<string, unknown> = {};
    let upsertRow: Record<string, unknown> | null = null;
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self;
    api.eq = (col: string, val: unknown) => { filters[col] = val; return api; };
    api.maybeSingle = async () => {
      const key = `${filters.org_id}:${filters.agent_name}`;
      const row = state.rows[key];
      return { data: row ?? null, error: null };
    };
    api.upsert = (row: Record<string, unknown>) => { upsertRow = row; return Promise.resolve().then(() => {
      const key = `${row.org_id}:${row.agent_name}`;
      state.rows[key] = {
        revoked: row.revoked as boolean,
        revoked_reason: (row.revoked_reason as string) ?? null,
        revoked_at: (row.revoked_at as string) ?? null,
      };
      return { data: null, error: null };
    }); };
    void upsertRow;
    return api;
  };
  return { getAdminClient: () => ({ from: () => builder() }) };
});

import { getAuthorizationState, setAuthorizationState } from "@/lib/guard";

beforeEach(() => { state.rows = {}; });

describe("guard.ts", () => {
  it("defaults to not-revoked when no row exists yet", async () => {
    const s = await getAuthorizationState("org_a", "loan-agent");
    expect(s).toEqual({ revoked: false, reason: null, revokedAt: null });
  });

  it("round-trips a revocation with its reason", async () => {
    await setAuthorizationState("org_a", "loan-agent", true, "Drift severity critical");
    const s = await getAuthorizationState("org_a", "loan-agent");
    expect(s.revoked).toBe(true);
    expect(s.reason).toBe("Drift severity critical");
    expect(s.revokedAt).toBeTruthy();
  });

  it("clears the reason and timestamp when un-revoking", async () => {
    await setAuthorizationState("org_a", "loan-agent", true, "Drift severity critical");
    await setAuthorizationState("org_a", "loan-agent", false, null);
    const s = await getAuthorizationState("org_a", "loan-agent");
    expect(s).toEqual({ revoked: false, reason: null, revokedAt: null });
  });

  it("is scoped per (org, agent) — one org's revocation doesn't affect another", async () => {
    await setAuthorizationState("org_a", "loan-agent", true, "x");
    const other = await getAuthorizationState("org_b", "loan-agent");
    expect(other.revoked).toBe(false);
  });
});
