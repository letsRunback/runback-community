import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncidentRow, IncidentStatus } from "@/lib/incidents";

/**
 * updateIncident() used to validate status against the enum (VALID_STATUSES)
 * but not against the CURRENT status — any of the 4 known statuses was
 * accepted from any other, so a direct API call could jump closed → open,
 * or open → closed skipping the investigation/remediation record entirely.
 * incidentsApiValidation.test.ts only ever exercised this with a mocked
 * updateIncident, so it could only prove enum membership, never transition
 * legality (see its own test titles/comments). These tests exercise the
 * REAL updateIncident() against VALID_TRANSITIONS.
 */

let incidentRow: IncidentRow;

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {};
      const self = () => c;
      c.select = self;
      c.eq = self;
      c.update = (patch: Record<string, unknown>) => {
        incidentRow = { ...incidentRow, ...patch } as IncidentRow;
        return c;
      };
      c.maybeSingle = () => Promise.resolve({ data: incidentRow });
      c.single = () => Promise.resolve({ data: incidentRow });
      return c;
    },
  }),
}));

function baseIncident(status: IncidentStatus): IncidentRow {
  return {
    id: "inc1",
    org_id: "org1",
    run_id: "run1",
    title: "t",
    status,
    severity: "medium",
    timeline: [],
    created_by: "a@b.com",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("updateIncident — real transition enforcement", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each([
    ["open", "investigating"],
    ["investigating", "remediated"],
    ["investigating", "closed"],
    ["remediated", "closed"],
  ] as const)("allows %s → %s", async (from, to) => {
    incidentRow = baseIncident(from);
    const { updateIncident } = await import("@/lib/incidents");
    const result = await updateIncident("inc1", "org1", { status: to }, "a@b.com");
    expect(result.ok).toBe(true);
  });

  it.each([
    ["closed", "open"],
    ["closed", "investigating"],
    ["closed", "remediated"],
    ["open", "remediated"],
    ["open", "closed"],
    ["remediated", "investigating"],
    ["remediated", "open"],
    ["investigating", "open"],
  ] as const)("rejects the illegal transition %s → %s", async (from, to) => {
    incidentRow = baseIncident(from);
    const { updateIncident } = await import("@/lib/incidents");
    const result = await updateIncident("inc1", "org1", { status: to }, "a@b.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("illegal_transition");
  });

  it("closed is terminal — VALID_TRANSITIONS.closed is empty", async () => {
    const { VALID_TRANSITIONS } = await import("@/lib/incidents");
    expect(VALID_TRANSITIONS.closed).toEqual([]);
  });

  it("a patch with no status change (e.g. just editing root_cause) is always allowed, regardless of current status", async () => {
    incidentRow = baseIncident("closed");
    const { updateIncident } = await import("@/lib/incidents");
    const result = await updateIncident("inc1", "org1", { root_cause: "updated analysis" }, "a@b.com");
    expect(result.ok).toBe(true);
  });

  it("re-sending the SAME status (idempotent patch) is allowed, not treated as a transition", async () => {
    incidentRow = baseIncident("investigating");
    const { updateIncident } = await import("@/lib/incidents");
    const result = await updateIncident("inc1", "org1", { status: "investigating" }, "a@b.com");
    expect(result.ok).toBe(true);
  });

  it("an illegal transition's error message names the actually-valid next step(s)", async () => {
    incidentRow = baseIncident("open");
    const { updateIncident } = await import("@/lib/incidents");
    const result = await updateIncident("inc1", "org1", { status: "closed" }, "a@b.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("investigating");
  });
});
