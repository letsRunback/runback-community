/**
 * Unauthenticated pages must never list runs across all orgs.
 *
 * This is a source-level guard because the bug it prevents was invisible in
 * every other check. `/` and `/runs` called listRuns() with no org filter,
 * relying on "we only do this when DEMO_MODE is on" for safety — and DEMO_MODE
 * was on in production. The pages rendered fine, all tests passed, and the site
 * was publishing every tenant's runs (including input and output text) to
 * anonymous visitors. It looked harmless only because the only rows in the
 * table were our own seed data.
 *
 * listRuns(limit, orgId) applies `.eq("org_id", orgId)` only when orgId is
 * truthy, so omitting the argument is a silent full-table read, not an error.
 * Any public caller must pass a scope.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Strip comments before scanning. Without this the guard matched its own
 * explanatory prose — a comment describing the bug ("this called getRun(run_id)
 * with no org") counted as a fresh occurrence of it, so documenting the fix
 * broke the test that enforced it.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const APP_DIR = join(process.cwd(), "web", "app");

/** Every page/route under app/ that is NOT behind the authenticated /app section. */
function publicSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // web/app/app/** is the signed-in product; it is org-scoped via the session.
      if (full.endsWith(`${join("web", "app", "app")}`)) continue;
      publicSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("public pages are org-scoped", () => {
  const files = publicSourceFiles(APP_DIR);

  it("finds the public tree (guard against a silently empty scan)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("never calls listRuns() without an org id", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = code(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/listRuns\(([^)]*)\)/g)) {
        const args = m[1].split(",");
        // listRuns(limit, orgId) — a second argument is the scope.
        if (args.length < 2 || !args[1].trim()) {
          offenders.push(`${f.replace(process.cwd() + "/", "")}: listRuns(${m[1]})`);
        }
      }
    }
    expect(offenders, `unscoped listRuns in public pages:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("never calls getRun() without an org id", () => {
    // The list page was scoped and the DETAIL page was not, so this guard
    // passed while /runs/<id> still served any tenant's run to anyone who knew
    // an id — and quickstart ids are unix timestamps, so "knew" means "guessed".
    // getRun(runId, orgId) applies `.eq("org_id")` only when orgId is truthy,
    // so a one-argument call is a silent cross-tenant read, not an error.
    const offenders: string[] = [];
    for (const f of files) {
      const src = code(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/getRun\(([^)]*)\)/g)) {
        const args = m[1].split(",");
        if (args.length < 2 || !args[1].trim()) {
          offenders.push(`${f.replace(process.cwd() + "/", "")}: getRun(${m[1]})`);
        }
      }
    }
    expect(offenders, `unscoped getRun in public pages:\n${offenders.join("\n")}`).toEqual([]);
  });
});
