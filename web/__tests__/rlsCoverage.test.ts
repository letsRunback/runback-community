/**
 * Every table must have row-level security enabled somewhere in sql/.
 *
 * Sixteen did not — including ad_ledger, ad_ledger_checkpoints, ad_policies,
 * approvals, incidents and trust_attestations, i.e. the governance tables.
 *
 * On the hosted database that was not a live exposure: RLS had been switched on
 * out of band, so anon reads return empty and anon writes return 42501. The
 * damage was to self-hosted deployments, which get exactly what these files
 * say. Most PostgREST setups grant anon SELECT on public tables by default, and
 * a table with a SELECT grant and no RLS is world-readable — so the same schema
 * was safe on our infrastructure and open on theirs.
 *
 * This guard fails when a new table is added without RLS. It checks the
 * migrations, not the database, precisely because that is where the two
 * disagreed: a passing probe against production said nothing about what a
 * customer's `docker compose up` would produce.
 *
 * Note what this does NOT assert. RLS being enabled is not tenant isolation
 * while every query runs as service_role, which bypasses it. See
 * docs/RLS-PLAN.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SQL_DIR = join(process.cwd(), "sql");

/** Views and helper tables that are not row-addressable tenant data. */
const EXEMPT = new Set<string>([
  // Add with a reason, never to silence the guard.
]);

function allSql(): string {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(SQL_DIR, f), "utf8"))
    .join("\n");
}

describe("row-level security coverage", () => {
  const sql = allSql();

  const created = new Set(
    [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1])
  );
  const protectedTables = new Set(
    [...sql.matchAll(/ALTER TABLE ([a-z_][a-z0-9_]*)\s+ENABLE ROW LEVEL SECURITY/gi)].map((m) => m[1])
  );

  it("finds the schema (guard against an empty scan)", () => {
    expect(created.size).toBeGreaterThan(40);
  });

  it("enables RLS on every table it creates", () => {
    const missing = [...created].filter((t) => !protectedTables.has(t) && !EXEMPT.has(t)).sort();
    expect(
      missing,
      `tables created without ENABLE ROW LEVEL SECURITY:\n${missing.join("\n")}\n\n` +
        "A self-hosted install grants anon SELECT on public tables by default, " +
        "so a table with no RLS is world-readable there. Add it to " +
        "sql/enable_rls_everywhere.sql, or to EXEMPT with a reason."
    ).toEqual([]);
  });

  it("does not pretend org-predicated policies exist yet", () => {
    // If someone adds `USING (org_id = ...)` while reads still run as
    // service_role, the schema will look isolated and behave exactly as before.
    // This fails loudly so the claim and the mechanism land together — see
    // docs/RLS-PLAN.md for the sequencing.
    const orgPredicated = /CREATE POLICY[^;]*USING\s*\([^)]*org_id\s*=/i.test(sql);
    if (orgPredicated) {
      const planned = readFileSync(join(process.cwd(), "docs", "RLS-PLAN.md"), "utf8");
      expect(
        planned.includes("step 2 done") || planned.includes("getTenantClient"),
        "org-predicated policies appeared in sql/ — reads must move off the " +
          "service-role client for them to have any effect, and docs/RLS-PLAN.md " +
          "and /security must stop describing this as roadmap."
      ).toBe(true);
    }
  });
});
