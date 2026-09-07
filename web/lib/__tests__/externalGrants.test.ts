/**
 * Pure scope-matching logic behind external auditor/regulator grants
 * (web/lib/externalGrants.ts) — the single place that decides whether a
 * grant currently authorizes reading a given run. DB-bound issuance/
 * revocation/resolution is covered by the self-hosted integration pass
 * instead, matching this codebase's convention of not unit-mocking Supabase.
 */
import { describe, it, expect } from "vitest";
import { grantCoversRun } from "@/lib/externalGrants";

const NOW = new Date("2026-06-01T00:00:00Z");
const FUTURE = "2026-07-01T00:00:00Z";
const PAST = "2026-05-01T00:00:00Z";

describe("grantCoversRun", () => {
  it("org_wide covers any run id, unexpired and unrevoked", () => {
    const grant = { scope_type: "org_wide" as const, run_ids: null, expires_at: FUTURE, revoked_at: null };
    expect(grantCoversRun(grant, "run-1", NOW)).toBe(true);
    expect(grantCoversRun(grant, "run-anything-else", NOW)).toBe(true);
  });

  it("run_ids covers only the listed runs", () => {
    const grant = { scope_type: "run_ids" as const, run_ids: ["run-1", "run-2"], expires_at: FUTURE, revoked_at: null };
    expect(grantCoversRun(grant, "run-1", NOW)).toBe(true);
    expect(grantCoversRun(grant, "run-3", NOW)).toBe(false);
  });

  it("run_ids with a null/empty list covers nothing", () => {
    expect(grantCoversRun({ scope_type: "run_ids", run_ids: null, expires_at: FUTURE, revoked_at: null }, "run-1", NOW)).toBe(false);
    expect(grantCoversRun({ scope_type: "run_ids", run_ids: [], expires_at: FUTURE, revoked_at: null }, "run-1", NOW)).toBe(false);
  });

  it("control_ids never covers a run — that scope is for compliance narratives only", () => {
    const grant = { scope_type: "control_ids" as const, run_ids: null, expires_at: FUTURE, revoked_at: null };
    expect(grantCoversRun(grant, "run-1", NOW)).toBe(false);
  });

  it("an expired grant covers nothing, regardless of scope", () => {
    const orgWide = { scope_type: "org_wide" as const, run_ids: null, expires_at: PAST, revoked_at: null };
    const runScoped = { scope_type: "run_ids" as const, run_ids: ["run-1"], expires_at: PAST, revoked_at: null };
    expect(grantCoversRun(orgWide, "run-1", NOW)).toBe(false);
    expect(grantCoversRun(runScoped, "run-1", NOW)).toBe(false);
  });

  it("a revoked grant covers nothing, even before its expiry and even for org_wide", () => {
    const grant = { scope_type: "org_wide" as const, run_ids: null, expires_at: FUTURE, revoked_at: "2026-05-15T00:00:00Z" };
    expect(grantCoversRun(grant, "run-1", NOW)).toBe(false);
  });
});
