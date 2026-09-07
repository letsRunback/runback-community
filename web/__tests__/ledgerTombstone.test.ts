/**
 * The one invariant retention depends on: a sealed ledger entry must never be
 * left without an explanation for why its run disappeared.
 *
 * Regression guard. enforceRetention() previously chained `.catch()` onto the
 * tombstone upsert, which never fires — a PostgREST query resolves with
 * { error } instead of rejecting — so a failed tombstone write was invisible
 * and the delete proceeded anyway, orphaning the entry it was meant to explain.
 * verifyLedger() then reported the org's ledger as TAMPERED, caused entirely by
 * our own tooling. tombstoneRuns() must report that failure, and callers must
 * treat `false` as "do not delete".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: () => ({ upsert }) }),
}));

const { tombstoneRuns } = await import("@/lib/ledger");

beforeEach(() => upsert.mockReset());

describe("tombstoneRuns", () => {
  it("reports failure when the tombstone write errors, so the caller can skip the delete", async () => {
    upsert.mockResolvedValue({ error: { message: "relation does not exist" } });
    expect(await tombstoneRuns("org1", ["r1"], "retention")).toBe(false);
  });

  it("does not mistake a resolved-with-error response for success", async () => {
    // The exact shape that defeated the old `.catch()`: resolves, never rejects.
    upsert.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect(await tombstoneRuns("org1", ["r1"], "retention")).toBe(false);
  });

  it("records org, run and reason for every doomed run", async () => {
    upsert.mockResolvedValue({ error: null });
    expect(await tombstoneRuns("org1", ["r1", "r2"], "seed-reset")).toBe(true);
    expect(upsert.mock.calls[0][0]).toEqual([
      { org_id: "org1", run_id: "r1", reason: "seed-reset" },
      { org_id: "org1", run_id: "r2", reason: "seed-reset" },
    ]);
  });

  it("succeeds without a write when there is nothing to delete", async () => {
    expect(await tombstoneRuns("org1", [], "retention")).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });
});
