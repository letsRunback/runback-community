/**
 * Every migration in sql/ must be mounted by docker-compose.
 *
 * Ten had drifted out of the list while the code that queries their tables
 * shipped, so a self-hosted deployment was missing admin audit, legal holds,
 * SIEM sinks, error events, workflow sinks, uptime checks, the agent registry,
 * and both aggregation RPCs. Those features did not degrade — they threw at
 * runtime, on a database that installed cleanly.
 *
 * The worst absence was scope_run_id_per_org.sql, which makes tenancy a
 * composite (org_id, run_id) key the database enforces. Missing it left
 * application-layer filtering as the only thing separating tenants, on exactly
 * the deployments chosen for being more isolated, not less.
 *
 * Adding a file to sql/ and forgetting this list is invisible: the app builds,
 * the containers start, and the gap only surfaces when a customer touches the
 * feature. So assert it instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const COMPOSE = readFileSync(join(REPO, "docker-compose.yml"), "utf8");

/** Files that intentionally do not belong in a fresh self-host install. */
const NOT_FOR_SELFHOST = new Set([
  // Applied to the hosted database as a one-off correction; a fresh install
  // already gets the corrected default from add_corpus_opt_in.sql.
  "update_corpus_opt_in_default.sql",
  // A verification query, not schema. It creates a temp table and impersonates
  // the tenant role to prove the policies filter; running it at database init
  // would be meaningless (no data yet) and would leave a temp table behind.
  // Run by hand against a live database — see docs/RLS-PLAN.md.
  "verify_tenant_policies.sql",
]);

describe("self-host schema is complete", () => {
  const files = readdirSync(join(REPO, "sql"))
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !NOT_FOR_SELFHOST.has(f));

  it("finds the migration set (guard against an empty scan)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("mounts every migration in docker-compose.yml", () => {
    const missing = files.filter((f) => !COMPOSE.includes(`./sql/${f}`)).sort();
    expect(
      missing,
      `in sql/ but never mounted by docker-compose.yml:\n${missing.join("\n")}\n\n` +
        "A self-hosted install will not have these tables, and the code that " +
        "queries them will throw at runtime."
    ).toEqual([]);
  });
});
