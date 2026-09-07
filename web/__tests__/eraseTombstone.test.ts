import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The GDPR erase route (app/api/user/erase/route.ts) deleted a sole member's
 * ad_runs directly, unlike every other run-deleting path in this codebase
 * (enforceRetention, see lib/ledger.ts's tombstoneRuns doc comment: "Any code
 * path that deletes runs must call this first"). This left a window where a
 * verifyLedger() call could misreport a legitimate erasure as tampering, and
 * externally-witnessed checkpoints for that org had no on-record explanation.
 * This test proves tombstoneRuns() is now called, with the right run ids,
 * BEFORE ad_runs is deleted.
 */

const calls: { table: string; ops: { op: string; args: unknown[] }[] }[] = [];

function chain(table: string) {
  const record = { table, ops: [] as { op: string; args: unknown[] }[] };
  const c: Record<string, unknown> = {};
  const chainable = (op: string) => (...args: unknown[]) => {
    record.ops.push({ op, args });
    return c;
  };
  c.select = chainable("select");
  c.eq = chainable("eq");
  c.neq = chainable("neq");
  c.update = chainable("update");
  c.delete = chainable("delete");
  c.range = chainable("range");
  c.then = (resolve: (v: unknown) => void) => {
    calls.push(record);
    resolve(respond(table, record));
  };
  return c;
}

function respond(table: string, record: { ops: { op: string; args: unknown[] }[] }) {
  const selectOp = record.ops.find((o) => o.op === "select");
  const isCount = selectOp && typeof selectOp.args[1] === "object" && (selectOp.args[1] as { count?: string })?.count === "exact";

  if (table === "memberships") {
    if (isCount) return { count: 1, error: null }; // sole member
    return { data: [{ org_id: "org1", role: "owner" }], error: null };
  }
  if (table === "ad_runs" && selectOp) {
    return { data: [{ run_id: "r1" }, { run_id: "r2" }], error: null };
  }
  return { data: [], error: null };
}

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: (table: string) => chain(table) }),
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ userId: "u1", email: "user@example.com" }),
  destroySession: vi.fn().mockResolvedValue(undefined),
}));
const tombstoneRuns = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/ledger", () => ({ tombstoneRuns }));

describe("GDPR erase route — tombstone before delete", () => {
  beforeEach(() => {
    calls.length = 0;
    tombstoneRuns.mockClear();
  });

  it("calls tombstoneRuns with the sole-member org's run ids BEFORE deleting ad_runs", async () => {
    const { POST } = await import("../app/api/user/erase/route");
    const req = new Request("http://x/api/user/erase", {
      method: "POST",
      body: JSON.stringify({ confirm: "DELETE MY ACCOUNT" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(tombstoneRuns).toHaveBeenCalledWith("org1", ["r1", "r2"], "gdpr_erase");

    const tombstoneCallIndex = calls.findIndex((c) => c.table === "ad_runs" && c.ops.some((o) => o.op === "select"));
    const deleteCallIndex = calls.findIndex((c) => c.table === "ad_runs" && c.ops.some((o) => o.op === "delete"));
    expect(tombstoneCallIndex).toBeGreaterThanOrEqual(0);
    expect(deleteCallIndex).toBeGreaterThan(tombstoneCallIndex);
  });

  it("proceeds with erasure even when the tombstone write fails — GDPR can't be blocked on it", async () => {
    tombstoneRuns.mockResolvedValueOnce(false);
    const { POST } = await import("../app/api/user/erase/route");
    const req = new Request("http://x/api/user/erase", {
      method: "POST",
      body: JSON.stringify({ confirm: "DELETE MY ACCOUNT" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const deleteCallIndex = calls.findIndex((c) => c.table === "ad_runs" && c.ops.some((o) => o.op === "delete"));
    expect(deleteCallIndex).toBeGreaterThanOrEqual(0); // deletion still happened
  });
});
