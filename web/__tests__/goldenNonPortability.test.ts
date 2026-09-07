/**
 * Golden corpus's moat is that verifying a "still fixed" incident requires
 * this org's own live Runback infrastructure (the run store, the policy
 * table, the replay package's hashing scheme) — there is no self-contained
 * cassette a competitor could get by exporting a row. See sql/create_golden.sql:
 * "a regression corpus a competitor starts at zero on."
 *
 * That property is currently true by omission — no export feature exists at
 * all (audited by hand, see the depth-audit research pass). It stays true
 * only if nobody adds a column to ad_golden / ad_golden_runs that inlines the
 * portable payload (raw trace events, policy rule content) an export could
 * then trivially ship. Pin the schema itself, not just "no export route
 * exists today" — a schema check catches the mistake at the source, before
 * any export route gets the chance to leak it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = join(process.cwd(), "sql");

/** Column names that would mean a golden-related table stopped being a
 * pointer into org-scoped infra and started carrying a portable payload. */
const FORBIDDEN_COLUMNS = ["events", "trace", "cassette", "rules", "rule_content", "redaction_config", "tool_schema"];

function columnsOf(sql: string, table: string): string[] {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\);`);
  const body = sql.match(re)?.[1] ?? "";
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--") && !line.startsWith("UNIQUE") && !line.startsWith("PRIMARY"))
    .map((line) => line.split(/\s+/)[0]);
}

describe("golden corpus stays non-portable by construction", () => {
  const goldenSql = readFileSync(join(SQL, "create_golden.sql"), "utf8");
  const historySql = readFileSync(join(SQL, "add_golden_history.sql"), "utf8");

  it("finds the table definitions (guard against a broken regex)", () => {
    expect(columnsOf(goldenSql, "ad_golden").length).toBeGreaterThan(5);
    expect(columnsOf(historySql, "ad_golden_runs").length).toBeGreaterThan(4);
  });

  it("ad_golden carries no embedded trace/cassette/policy payload — only pointers and digests", () => {
    const cols = columnsOf(goldenSql, "ad_golden");
    const found = FORBIDDEN_COLUMNS.filter((f) => cols.includes(f));
    expect(found, `ad_golden has a portable-payload column: ${found.join(", ")}`).toEqual([]);
  });

  it("ad_golden_runs (the append-only history) carries no embedded payload either", () => {
    const cols = columnsOf(historySql, "ad_golden_runs");
    const found = FORBIDDEN_COLUMNS.filter((f) => cols.includes(f));
    expect(found, `ad_golden_runs has a portable-payload column: ${found.join(", ")}`).toEqual([]);
    // policy_digest specifically must stay a hash, never the rule content it
    // fingerprints — that's the whole point of hashing it instead of storing it.
    expect(cols).toContain("policy_digest");
  });

  it("no export or download route exists for golden/datasets that could bulk-ship this data", () => {
    // Not a schema check — a point-in-time audit of the API surface, re-run on
    // every CI run so a new export route gets caught in review rather than
    // discovered later. If this ever needs to fail on purpose (a real export
    // feature gets built), that's a deliberate decision to update this test,
    // not something to happen by accident.
    const apiDir = join(process.cwd(), "web", "app", "api");
    const hits: string[] = [];
    const walk = (dir: string, relative: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readdirSync, statSync } = require("node:fs");
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const rel = `${relative}/${entry}`;
        if (statSync(full).isDirectory()) walk(full, rel);
        // Matched against the route path relative to api/, never the absolute
        // filesystem path — the repo can live under a directory whose own
        // name (e.g. "Downloads") false-matches /download/i otherwise.
        else if (/route\.ts$/.test(entry) && /golden|dataset/i.test(rel) && /export|download/i.test(rel)) {
          hits.push(rel);
        }
      }
    };
    walk(apiDir, "");
    expect(hits, `found a golden/dataset export route — verify it can't ship raw events/policy content:\n${hits.join("\n")}`).toEqual([]);
  });
});
