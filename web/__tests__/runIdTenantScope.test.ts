/**
 * Every query that filters on run_id must also filter on org_id.
 *
 * (org_id, run_id) is the identity of a run — sql/scope_run_id_per_org.sql.
 * run_id alone is no longer unique, so a query filtered only by run_id can
 * match a different tenant's rows. The consequences are not uniform:
 *
 *   - a SELECT returns another org's data (leak, or merged aggregates)
 *   - .single()/.maybeSingle() ERRORS once two orgs share an id, turning a
 *     working feature into "not found"
 *   - a DELETE or UPDATE modifies another org's rows. enforceRetention() had
 *     two of these: one org's retention sweep would have deleted a second
 *     org's events wherever a run id was shared.
 *
 * A source-level guard because none of it shows up in behaviour until two
 * tenants collide on an id, which no unit test naturally produces.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "web");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!/node_modules|\.next|__tests__/.test(full)) sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Each `.from("<table>")` chain, bounded by the next `.from(` so chains don't bleed. */
function* chains(src: string): Generator<{ table: string; text: string; index: number }> {
  const re = /\.from\(\s*["'](ad_runs|ad_events)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const next = src.indexOf(".from(", m.index + 6);
    // 1200, not 800: a verbose inline comment ahead of the ownership check
    // (this codebase's own established style — see bisect/reexecute routes)
    // pushed the actual `scope.org_id !== callerOrgId` comparison to ~870
    // chars out, past the old 800 cap — silently excluding the very check
    // being documented from the window meant to see it.
    const end = next === -1 ? Math.min(m.index + 1200, src.length) : Math.min(next, m.index + 1200);
    yield { table: m[1], text: src.slice(m.index, end), index: m.index };
    re.lastIndex = m.index + 1; // adjacent chains must not be swallowed
  }
}

/**
 * True when this chain is safely org-scoped. Was `/org_id/.test(c.text)` — a
 * bare substring check over the whole window, not a check that org_id is
 * actually USED. A comment mentioning org_id, an unrelated variable name, or
 * a second statement inside the window all made that pass with nothing real
 * behind it.
 *
 * Two shapes are both genuinely safe, and both appear throughout this
 * codebase — a real .eq/.in("org_id", ...) filter (the query itself is
 * scoped), OR a `select("org_id")` immediately followed by an in-app
 * `<result>.org_id !== callerOrgId` comparison (the canonical "look up who
 * owns this run_id, then check before using it" pattern — you can't filter
 * by org_id in the query when the point of the query is discovering it for
 * an id you don't yet trust). Only ONE of the two is required.
 */
function isOrgScoped(chainText: string): boolean {
  const filtersOrgId = /\.(eq|in)\(\s*["']org_id["']/.test(chainText);
  // Either operand order — `scope.org_id !== x` or `x !== scope.org_id` —
  // bounded to ~20 chars so it can't reach across an unrelated statement and
  // false-match the way the old bare substring check did.
  const checksOrgIdInApp =
    /\.org_id\b[^;]{0,20}(===|!==|==|!=)/.test(chainText) ||
    /(===|!==|==|!=)[^;]{0,20}\.org_id\b/.test(chainText);
  return filtersOrgId || checksOrgIdInApp;
}

describe("isOrgScoped() — the guard's own precision", () => {
  it("passes a real .eq('org_id', ...) filter", () => {
    expect(isOrgScoped(`.from("ad_runs").select("*").eq("run_id", id).eq("org_id", orgId)`)).toBe(true);
  });

  it("passes the look-up-then-compare idiom, either operand order", () => {
    expect(isOrgScoped(`.from("ad_runs").select("org_id").eq("run_id", id).maybeSingle();\nif (scope.org_id !== callerOrgId) fail();`)).toBe(true);
    expect(isOrgScoped(`.from("ad_runs").select("org_id").eq("run_id", id).maybeSingle();\nif (callerOrgId !== scope.org_id) fail();`)).toBe(true);
  });

  it("REJECTS a query with neither a filter nor an app-level check — the real gap this guard exists to catch", () => {
    expect(isOrgScoped(`.from("ad_runs").select("output").eq("run_id", id).maybeSingle();\nreturn data.output;`)).toBe(false);
  });

  it("REJECTS a bare mention of org_id with no comparison operator near it (a comment, an unrelated identifier)", () => {
    expect(isOrgScoped(`.from("ad_runs").select("output").eq("run_id", id);\n// note: org_id is handled elsewhere, allegedly`)).toBe(false);
  });
});

describe("run_id queries are tenant-scoped", () => {
  const files = sourceFiles(ROOT);

  it("scans a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no query filters on run_id without also filtering on org_id", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const c of chains(src)) {
        const filtersRunId = /\.(eq|in)\(\s*["']run_id["']/.test(c.text);
        if (!filtersRunId) continue;
        if (isOrgScoped(c.text)) continue;
        // Cron/system jobs (authenticated via cronAuthorized(), not a caller
        // org) legitimately aggregate ACROSS every org in one query — that's
        // not a leak, it's the job. enforceRetention() (lib/usage.ts) is the
        // same pattern and is the reason this guard's own docstring cites it
        // approvingly.
        if (/\/api\/cron\//.test(f)) continue;
        const line = src.slice(0, c.index).split("\n").length;
        offenders.push(`${f.replace(process.cwd() + "/", "")}:${line} (${c.table})`);
      }
    }
    expect(
      offenders,
      `run_id filtered without org_id — (org_id, run_id) is the identity:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("upserts target the composite constraints, not the dropped ones", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/onConflict:\s*["']([^"']+)["']/g)) {
        const cols = m[1].split(",").map((s) => s.trim());
        // These exact targets named constraints that the migration dropped.
        if (cols.join(",") === "run_id" || cols.join(",") === "run_id,span_id") {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${f.replace(process.cwd() + "/", "")}:${line} onConflict: "${m[1]}"`);
        }
      }
    }
    expect(offenders, `stale upsert conflict targets:\n${offenders.join("\n")}`).toEqual([]);
  });
});
