/**
 * The platform audit log must detect edits and deletions of its own entries.
 *
 * It is hash-chained for the same reason the run ledger is: an administrator
 * investigating an incident has to be able to trust that the record of who
 * revoked a key or changed an SSO domain has not been quietly rewritten by
 * whoever did it. A log that can be edited by the people it audits is
 * decoration.
 *
 * Verification is content-derived — each entry's leaf is recomputed from the
 * stored fields — so an edit is caught even when the chain hashes are left
 * untouched, and a deletion is caught by the sequence gap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const state: {
  rows: Record<string, unknown>[];
  error: { message: string } | null;
  checkpoint: { seq: number; head_hash: string; signature: string } | null;
  ckptError: { message: string } | null;
  witnesses: { tsa: string }[];
} = { rows: [], error: null, checkpoint: null, ckptError: null, witnesses: [] };

vi.mock("@/lib/supabase/admin", () => {
  // Per-table routing: the checkpoint table is a different shape from the event
  // table, and a single shared result would let the anchor lookup silently read
  // admin events as checkpoints.
  const ckptBuilder = () => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self; api.eq = self; api.order = self; api.limit = self; api.range = self;
    api.insert = async () => ({ error: null });
    api.maybeSingle = async () => ({ data: state.checkpoint, error: state.ckptError });
    return api;
  };
  // Witness receipts are a LIST, not a maybeSingle — a separate builder so the
  // two shapes cannot be confused for each other.
  const witnessBuilder = () => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self; api.eq = self; api.order = self; api.upsert = async () => ({ error: null });
    const result = () => ({ data: state.witnesses, error: null });
    api.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(res, rej);
    api.catch = (fn: (e: unknown) => unknown) => Promise.resolve(result()).catch(fn);
    return api;
  };
  const builder = () => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self; api.eq = self; api.order = self; api.limit = self;
    // range() SLICES rather than ignoring its arguments. verifyAdminChain pages
    // through the log, and a mock that returned every row for any range would
    // make a broken pager look correct — the same class of false pass the
    // unbounded query itself produced against PostgREST's silent 1000-row cap.
    let from = 0;
    let to = Number.MAX_SAFE_INTEGER;
    api.range = (f: number, t: number) => { from = f; to = t; return api; };
    const result = () =>
      state.error
        ? { data: null, error: state.error }
        : { data: state.rows.slice(from, to + 1), error: null };
    api.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(res, rej);
    api.catch = (fn: (e: unknown) => unknown) => Promise.resolve(result()).catch(fn);
    return api;
  };
  return {
    getAdminClient: () => ({
      from: (table: string) =>
        table === "ad_admin_checkpoints" ? ckptBuilder()
        : table === "ad_admin_witnesses" ? witnessBuilder()
        : builder(),
      rpc: async () => ({ error: null }),
    }),
  };
});

const { verifyAdminChain } = await import("@/lib/adminAudit");
const { sha256, canonical } = await import("@runback/replay");

const leafOf = (e: Record<string, unknown>) =>
  sha256("admin:" + canonical({
    event_id: e.event_id, action: e.action, actor_kind: e.actor_kind,
    actor_email: e.actor_email ?? null, target_type: e.target_type ?? null,
    target_id: e.target_id ?? null, metadata: e.metadata ?? {}, ip: e.ip ?? null,
  }));

/** A well-formed chain of n entries. */
function chain(n: number) {
  const rows: Record<string, unknown>[] = [];
  let prev = "";
  for (let i = 0; i < n; i++) {
    const e: Record<string, unknown> = {
      seq: i, event_id: `e${i}`, actor_kind: "user", actor_email: "admin@acme.com",
      action: "model_key.set", target_type: "provider", target_id: "openai",
      metadata: { last4: "1234" }, ip: "1.2.3.4",
    };
    e.leaf_hash = leafOf(e);
    e.prev_hash = prev;
    e.entry_hash = sha256(prev + (e.leaf_hash as string));
    prev = e.entry_hash as string;
    rows.push(e);
  }
  return rows;
}

beforeEach(() => { state.rows = []; state.error = null; state.checkpoint = null; state.ckptError = null; state.witnesses = []; });

describe("admin audit chain", () => {
  it("verifies an untouched chain", async () => {
    state.rows = chain(4);
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(true);
    expect(v.count).toBe(4);
    expect(v.brokenAt).toBeNull();
  });

  it("treats an empty log as intact, not broken", async () => {
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(true);
    expect(v.count).toBe(0);
  });

  it("detects an entry edited after the fact", async () => {
    const rows = chain(4);
    // Someone rewrites who performed the action but leaves the hashes alone.
    rows[2].actor_email = "someone.else@acme.com";
    state.rows = rows;
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(false);
    expect(v.brokenAt?.seq).toBe(2);
    expect(v.brokenAt?.reason).toMatch(/altered/i);
  });

  it("detects a deleted entry via the sequence gap", async () => {
    const rows = chain(4);
    rows.splice(2, 1); // remove seq 2 entirely
    state.rows = rows;
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(false);
    expect(v.brokenAt?.reason).toMatch(/missing|truncated|deleted/i);
  });

  it("detects a relinked chain", async () => {
    const rows = chain(4);
    rows[3].prev_hash = "0".repeat(64);
    state.rows = rows;
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(false);
    expect(v.brokenAt?.seq).toBe(3);
    expect(v.brokenAt?.reason).toMatch(/chain broken/i);
  });

  it("reports an unreadable log as unknown, never as tampering", async () => {
    state.error = { message: "connection reset" };
    const v = await verifyAdminChain("org");
    expect(v.intact).toBeNull();
    expect(v.brokenAt).toBeNull();
    expect(v.note).toMatch(/not a tamper finding/i);
  });
});

describe("admin audit chain paging", () => {
  it("verifies a chain longer than one page", async () => {
    // PostgREST caps an unbounded select at 1000 rows. verifyAdminChain used
    // one, so for any org past that it checked only the OLDEST 1000 entries and
    // still returned intact:true — a clean pass over an unverified tail.
    state.rows = chain(1200);
    state.error = null;
    const v = await verifyAdminChain("org");
    expect(v.count).toBe(1200);
    expect(v.intact).toBe(true);
  });

  it("still catches tampering beyond the first page", async () => {
    // The case the old code could not see at all: an entry edited past row
    // 1000 was simply never read.
    const rows = chain(1200);
    (rows[1100] as Record<string, unknown>).actor_email = "attacker@evil.com";
    state.rows = rows;
    state.error = null;
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(false);
    expect(v.brokenAt?.seq).toBe(1100);
  });
});

/**
 * The anchor is the half of tamper-evidence that hash re-derivation cannot
 * provide. Re-deriving catches an editor who forgot to fix up the chain;
 * anyone with database write access can recompute every leaf, prev and entry
 * hash after tampering, and the chain then verifies perfectly clean. The HMAC
 * key is not in the database, so a rewritten chain cannot produce a matching
 * signed checkpoint.
 */
describe("admin audit chain anchor", () => {
  const KEY = "test-audit-key";
  const hm = (payload: string) =>
    crypto.createHmac("sha256", KEY).update(payload).digest("hex");

  beforeEach(() => { process.env.AUDIT_SIGNING_KEY = KEY; });

  it("reports an unanchored chain as internally consistent, not as verified", async () => {
    state.rows = chain(4);
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(true);
    expect(v.anchored).toBe(false);
    // The wording matters: a bare "verified" would overclaim.
    expect(v.note).toMatch(/internal consistency only|not that the log was never rewritten/i);
  });

  it("reports anchored when the head matches a signed checkpoint", async () => {
    const rows = chain(4);
    state.rows = rows;
    const head = rows[3].entry_hash as string;
    state.checkpoint = { seq: 4, head_hash: head, signature: hm(`admin:org:4:${head}`) };
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(true);
    expect(v.anchored).toBe(true);
  });

  it("catches a fully rewritten chain that re-derives clean", async () => {
    // The attack the anchor exists for: entries removed and every hash
    // recomputed, so hash verification alone sees nothing wrong.
    const full = chain(6);
    const sealedHead = full[5].entry_hash as string;
    state.checkpoint = { seq: 6, head_hash: sealedHead, signature: hm(`admin:org:6:${sealedHead}`) };
    state.rows = chain(3); // shorter, but internally perfect
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(false);
    expect(v.note).toMatch(/entries have been removed/i);
  });

  it("rejects a checkpoint that is not validly signed", async () => {
    const rows = chain(4);
    state.rows = rows;
    state.checkpoint = { seq: 4, head_hash: rows[3].entry_hash as string, signature: "deadbeef" };
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(false);
    expect(v.anchored).toBe(false);
  });
});

describe("admin chain witnessing", () => {
  const KEY = "test-audit-key";
  const hm = (p: string) => crypto.createHmac("sha256", KEY).update(p).digest("hex");
  beforeEach(() => { process.env.AUDIT_SIGNING_KEY = KEY; });

  const sealed = (n: number) => {
    const rows = chain(n);
    state.rows = rows;
    const head = rows[n - 1].entry_hash as string;
    state.checkpoint = { seq: n, head_hash: head, signature: hm(`admin:org:${n}:${head}`) };
  };

  it("says plainly when an anchor rests only on our own key", async () => {
    sealed(4);
    state.witnesses = [];
    const v = await verifyAdminChain("org");
    expect(v.anchored).toBe(true);
    expect(v.witnesses).toEqual([]);
    // The distinction that matters: anchored is not the same as witnessed.
    // Whoever holds AUDIT_SIGNING_KEY can re-sign a rewritten chain, so an
    // unwitnessed anchor must not read as third-party proof.
    expect(v.note).toMatch(/self-attested only/i);
  });

  it("names the time-stamping authorities when they exist", async () => {
    sealed(4);
    state.witnesses = [{ tsa: "freetsa.org" }, { tsa: "digicert" }];
    const v = await verifyAdminChain("org");
    expect(v.witnesses).toEqual(["freetsa.org", "digicert"]);
    expect(v.note).toMatch(/freetsa\.org, digicert/);
    expect(v.note).not.toMatch(/self-attested only/i);
  });

  it("treats an unreadable witness table as absence, never as tampering", async () => {
    sealed(4);
    // @ts-expect-error — deliberately wrong shape, to force the read to throw.
    state.witnesses = null;
    const v = await verifyAdminChain("org");
    expect(v.intact).toBe(true);
    expect(v.witnesses).toEqual([]);
  });
});
