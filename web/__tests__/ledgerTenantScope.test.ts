/**
 * verifyLedger must answer "does THIS org still hold the run it sealed",
 * not "does a run with this id exist anywhere".
 *
 * ad_runs.run_id is globally unique and owned by its first writer, so an id
 * freed by a deletion can later be claimed by a different tenant. The run
 * lookup had no org filter, so org A's sealed entry could be satisfied by
 * org B's run — observed for real while migrating the demo workspace, where
 * three ids were deleted from one org and re-seeded into another.
 *
 * Also pins the failure mode: an unreadable run store must report "cannot
 * verify", never "tamper detected". Verification is fail-closed, but closed
 * means "unconfirmed", and a false tamper alarm on the audit screen is the
 * most expensive wrong answer this product can give.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const state: {
  entries: { seq: number; run_id: string; leaf_hash: string; prev_hash: string; entry_hash: string }[];
  runs: { run_id: string; org_id: string; cassette_digest?: string }[];
  runsError: { message: string } | null;
  lastRunFilters: Record<string, unknown>;
  tombstones: { run_id: string; reason: string }[];
  checkpoint: { seq: number; head_hash: string; merkle_root: string; signature: string | null } | null;
} = { entries: [], runs: [], runsError: null, lastRunFilters: {}, tombstones: [], checkpoint: null };

vi.mock("@/lib/planGate", () => ({ assertFeature: async () => {} }));

vi.mock("@/lib/supabase/admin", () => {
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self;
    api.order = self;
    api.limit = self;
    api.in = self;
    // fetchEntries pages with .range() rather than reading unbounded, because
    // PostgREST silently caps an unbounded select at 1000 rows — which made an
    // untouched ledger past that length report as tampered. The double has to
    // model the paging, or it verifies a code path production never takes.
    api.range = (from: number, to: number) => {
      rangeFrom = from;
      rangeTo = to;
      return api;
    };
    api.eq = (col: string, val: unknown) => {
      filters[col] = val;
      if (table === "ad_runs") state.lastRunFilters = { ...filters };
      return api;
    };
    api.maybeSingle = async () =>
      table === "ad_ledger_checkpoints"
        ? { data: state.checkpoint, error: null }
        : { data: null, error: null };

    const result = () => {
      if (table === "ad_ledger") {
        const rows =
          rangeFrom === null ? state.entries : state.entries.slice(rangeFrom, (rangeTo ?? 0) + 1);
        return { data: rows, error: null };
      }
      if (table === "ad_runs") {
        if (state.runsError) return { data: null, error: state.runsError };
        const org = filters["org_id"];
        // Mirror PostgREST: .eq("org_id", x) filters; its absence does not.
        const rows = org === undefined ? state.runs : state.runs.filter((r) => r.org_id === org);
        return { data: rows, error: null };
      }
      if (table === "ad_ledger_tombstones") return { data: state.tombstones, error: null };
      return { data: [], error: null };
    };
    // A real thenable: production code both awaits these chains and calls
    // .then().catch() on them, and the mock has to support each.
    api.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(res, rej);
    api.catch = (fn: (e: unknown) => unknown) => Promise.resolve(result()).catch(fn);
    return api;
  };
  return { getAdminClient: () => ({ from: (t: string) => builder(t) }) };
});

const { verifyLedger, runLeaf, merkleRoot } = await import("@/lib/ledger");

const ORG_A = "org-a";
const ORG_B = "org-b";
const run = (run_id: string) => ({
  run_id, name: "agent", status: "success",
  cassette_digest: "d1", ended_at: "2026-01-01T00:00:00Z", step_count: 3,
});

/** One sealed entry for `run_id`, chained from genesis. */
function sealOne(run_id: string) {
  const leaf = runLeaf(run(run_id));
  const entry = createHash("sha256").update("" + leaf).digest("hex");
  return [{ seq: 1, run_id, leaf_hash: leaf, prev_hash: "", entry_hash: entry }];
}

beforeEach(() => {
  state.entries = [];
  state.runs = [];
  state.runsError = null;
  state.lastRunFilters = {};
  state.tombstones = [];
  state.checkpoint = null;
  delete process.env.AUDIT_SIGNING_KEY;
});

describe("verifyLedger is per-tenant", () => {
  it("scopes the run lookup to the verifying org", async () => {
    state.entries = sealOne("r1");
    state.runs = [{ ...run("r1"), org_id: ORG_A }];
    await verifyLedger(ORG_A, true);
    expect(state.lastRunFilters.org_id).toBe(ORG_A);
  });

  it("does not accept another tenant's run as backing for a sealed entry", async () => {
    state.entries = sealOne("shared-id");
    // Same run_id, but it belongs to org B now.
    state.runs = [{ ...run("shared-id"), org_id: ORG_B }];
    const v = await verifyLedger(ORG_A, true);
    // Org A no longer holds it and wrote no tombstone → an honest finding,
    // not a silent pass borrowed from another tenant.
    expect(v.intact).toBe(false);
    expect(v.brokenAt?.run_id).toBe("shared-id");
  });

  it("still verifies when the org does hold the run", async () => {
    state.entries = sealOne("r1");
    state.runs = [{ ...run("r1"), org_id: ORG_A }];
    const v = await verifyLedger(ORG_A, true);
    expect(v.intact).toBe(true);
    expect(v.brokenAt).toBeNull();
  });
});

describe("a tombstoned entry whose id was reused", () => {
  it("stays retired instead of being compared against the new run", async () => {
    // Run ids are chosen by the caller, so an id can be deleted under policy and
    // later reused. The demo seed does exactly this on every re-run. Comparing
    // the sealed leaf against whatever holds the id now compares two unrelated
    // runs and reports tampering for a ledger that is behaving correctly.
    state.entries = sealOne("reused-id");
    // A DIFFERENT run now holds the id — content deliberately does not match.
    state.runs = [{ ...run("reused-id"), cassette_digest: "different", org_id: ORG_A }];
    state.tombstones = [{ run_id: "reused-id", reason: "seed-reset" }];
    const v = await verifyLedger(ORG_A, true);
    expect(v.intact).toBe(true);
    expect(v.retired?.count).toBe(1);
    expect(v.retired?.reasons).toContain("seed-reset");
  });

  it("still reports an unexplained content change when there is no tombstone", async () => {
    state.entries = sealOne("r1");
    state.runs = [{ ...run("r1"), cassette_digest: "tampered", org_id: ORG_A }];
    state.tombstones = [];
    const v = await verifyLedger(ORG_A, true);
    expect(v.intact).toBe(false);
    expect(v.brokenAt?.reason).toMatch(/altered/i);
  });
});

describe("a rotated signing key is not a tamper finding", () => {
  it("names the signature as the cause and points at the fix", async () => {
    // Chain re-derives cleanly; only the checkpoint signature fails. That is a
    // rotated AUDIT_SIGNING_KEY with no PREVIOUS set — a config mistake with a
    // 30-second fix. Reporting it as tampering sends someone hunting an
    // intruder through an audit trail that is completely intact.
    state.entries = sealOne("r1");
    state.runs = [{ ...run("r1"), org_id: ORG_A }];
    // Head and root deliberately match the sealed chain, so ONLY the signature
    // is wrong — which is what a rotation looks like.
    state.checkpoint = {
      seq: 1,
      head_hash: state.entries[0].entry_hash,
      merkle_root: merkleRoot([state.entries[0].leaf_hash]),
      signature: "not-a-valid-signature",
    };
    process.env.AUDIT_SIGNING_KEY = "a".repeat(64);
    const v = await verifyLedger(ORG_A, true);
    expect(v.brokenAt).toBeNull();          // nothing in the chain is wrong
    expect(v.note).toMatch(/signature does not verify/i);
    expect(v.note).toMatch(/AUDIT_SIGNING_KEY_PREVIOUS/);
    expect(v.note).not.toMatch(/tamper/i);
  });
});

describe("an unreadable run store is not a tamper finding", () => {
  it("reports intact=null rather than false", async () => {
    state.entries = sealOne("r1");
    state.runsError = { message: "connection reset" };
    const v = await verifyLedger(ORG_A, true);
    expect(v.intact).toBeNull();
    expect(v.brokenAt).toBeNull();
    expect(v.note).toMatch(/not a tamper finding/i);
  });
});
