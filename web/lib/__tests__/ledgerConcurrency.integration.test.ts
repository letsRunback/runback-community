import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";

/**
 * Proves pg_advisory_xact_lock (sql/create_ledger.sql's ledger_append) actually
 * prevents a forked chain under real concurrent writes — the one thing the
 * ledger's tamper-evidence rests on that had never been exercised against a
 * real Postgres. Every other ledger test (ledger.test.ts) mocks the DB, which
 * cannot observe lock contention at all.
 *
 * Requires a throwaway Postgres reachable at LEDGER_TEST_DATABASE_URL with
 * sql/create_tenancy.sql (for `orgs`) and sql/create_ledger.sql already
 * applied. Skipped otherwise — this is deliberately not part of the
 * no-DB-required standard suite. To run it locally:
 *
 *   docker run -d --name rb-ledger-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16-alpine
 *   docker exec -i rb-ledger-test-pg psql -U postgres -d postgres < ../../sql/create_tenancy.sql
 *   docker exec -i rb-ledger-test-pg psql -U postgres -d postgres < ../../sql/create_ledger.sql
 *   LEDGER_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres \
 *     npx vitest run web/lib/__tests__/ledgerConcurrency.integration.test.ts
 */

const DB_URL = process.env.LEDGER_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("ledger_append — concurrency (real Postgres, not mocked)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pool: any;
  let orgId: string;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: DB_URL });
    const res = await pool.query(
      "INSERT INTO orgs(name, slug) VALUES ($1, $2) RETURNING id",
      [`ledger-concurrency-${Date.now()}`, `ledger-concurrency-${Date.now()}-${Math.random().toString(36).slice(2)}`]
    );
    orgId = res.rows[0].id;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM ad_ledger WHERE org_id = $1", [orgId]);
      await pool.query("DELETE FROM orgs WHERE id = $1", [orgId]);
      await pool.end();
    }
  });

  it("assigns strictly sequential, gap-free seq numbers under 50 concurrent appends to the same org", async () => {
    const N = 50;
    const leaves = Array.from({ length: N }, (_, i) => crypto.createHash("sha256").update(`leaf-${i}`).digest("hex"));

    // Fire all 50 ledger_append calls at once — this is the scenario the mock-DB
    // unit tests structurally cannot exercise: N real Postgres connections racing
    // for the same org's advisory lock.
    await Promise.all(
      leaves.map((leaf, i) => pool.query("SELECT * FROM ledger_append($1, $2, $3)", [orgId, `run-${i}`, leaf]))
    );

    const { rows } = await pool.query(
      "SELECT seq, run_id, leaf_hash, prev_hash, entry_hash FROM ad_ledger WHERE org_id = $1 ORDER BY seq ASC",
      [orgId]
    );

    expect(rows).toHaveLength(N);
    // No forked/duplicate/skipped seq — exactly 0..N-1, once each.
    expect(rows.map((r: { seq: string }) => Number(r.seq))).toEqual(Array.from({ length: N }, (_, i) => i));

    // The chain actually links: each entry_hash = sha256(prev row's entry_hash || this leaf),
    // and each row's prev_hash matches the previous row's entry_hash — a fork would show up
    // as two rows claiming the same seq (impossible here, PK denies it) or a broken link.
    let prev = "";
    for (const row of rows) {
      expect(row.prev_hash).toBe(prev);
      const expectedEntry = crypto.createHash("sha256").update(prev + row.leaf_hash).digest("hex");
      expect(row.entry_hash).toBe(expectedEntry);
      prev = row.entry_hash;
    }
  });

  it("is idempotent under concurrent retries of the same (org, run) — never double-appends or forks", async () => {
    const leaf = crypto.createHash("sha256").update("retry-leaf").digest("hex");
    const before = await pool.query("SELECT COUNT(*)::int AS n FROM ad_ledger WHERE org_id = $1", [orgId]);

    // 10 concurrent "retries" of the exact same append (the real-world case this
    // guards: a client that times out and retries without knowing if the first
    // attempt landed).
    const results = await Promise.all(
      Array.from({ length: 10 }, () => pool.query("SELECT * FROM ledger_append($1, $2, $3)", [orgId, "retry-run", leaf]))
    );

    const after = await pool.query("SELECT COUNT(*)::int AS n FROM ad_ledger WHERE org_id = $1", [orgId]);
    expect(after.rows[0].n).toBe(before.rows[0].n + 1); // exactly one row appended, not 10

    // Every concurrent caller gets back the SAME seq/hashes — the row that actually won.
    const seqs = new Set(results.map((r) => r.rows[0].seq));
    const entries = new Set(results.map((r) => r.rows[0].entry_hash));
    expect(seqs.size).toBe(1);
    expect(entries.size).toBe(1);
  });

  it("keeps two orgs' chains independent under interleaved concurrent appends", async () => {
    const other = await pool.query(
      "INSERT INTO orgs(name, slug) VALUES ($1, $2) RETURNING id",
      [`ledger-concurrency-b-${Date.now()}`, `ledger-concurrency-b-${Date.now()}-${Math.random().toString(36).slice(2)}`]
    );
    const orgB = other.rows[0].id;
    try {
      const calls: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        const leaf = crypto.createHash("sha256").update(`cross-${i}`).digest("hex");
        calls.push(pool.query("SELECT * FROM ledger_append($1, $2, $3)", [orgId, `cross-a-${i}`, leaf]));
        calls.push(pool.query("SELECT * FROM ledger_append($1, $2, $3)", [orgB, `cross-b-${i}`, leaf]));
      }
      await Promise.all(calls);

      const bRows = await pool.query("SELECT seq FROM ad_ledger WHERE org_id = $1 ORDER BY seq ASC", [orgB]);
      expect(bRows.rows.map((r: { seq: string }) => Number(r.seq))).toEqual(Array.from({ length: 20 }, (_, i) => i));
    } finally {
      await pool.query("DELETE FROM ad_ledger WHERE org_id = $1", [orgB]);
      await pool.query("DELETE FROM orgs WHERE id = $1", [orgB]);
    }
  });
});
