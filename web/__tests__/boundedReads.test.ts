/**
 * Reads that feed a reported number must be bounded, counted, or paged.
 *
 * PostgREST caps rows per request (db-max-rows). A query with no bound does not
 * fail when it exceeds the cap — it returns a prefix, with nothing marking it
 * as one. Code that then sums or counts the array reports a confident, precise,
 * wrong figure.
 *
 * That already happened twice here, in the two places it costs most:
 *
 *   • the compliance report computed policy enforcement from
 *     runs.slice(0, 1000) — 200 blocks reported against 500 actual on a
 *     2,500-run dataset, in the document handed to a regulator
 *   • cost attribution used runIds.slice(0, 500) — 50,000 tokens counted
 *     against 120,000 actual, in the number teams are billed from
 *
 * Both worked perfectly on a small dataset, which is why they survived. This
 * guard fails on a new unbounded read rather than waiting for a customer big
 * enough to expose it.
 *
 * An acceptable read does ONE of:
 *   .limit(n)      — a deliberate cap, visible in the source
 *   .single() / .maybeSingle()  — one row
 *   count: "exact" — counted in the database
 *   .range(from, to) — paged, via readAll()
 */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "web");
const VOLUME_TABLES = ["ad_runs", "ad_events"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!/node_modules|\.next|__tests__/.test(full)) sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Documentation examples are not queries; strip comments before scanning. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
            .replace(/^\s*\/\/.*$/gm, "");
}

function* chains(src: string): Generator<{ table: string; text: string; index: number }> {
  const re = new RegExp(`\\.from\\(\\s*["'](${VOLUME_TABLES.join("|")})["']\\s*\\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const next = src.indexOf(".from(", m.index + 6);
    const end = next === -1 ? Math.min(m.index + 800, src.length) : Math.min(next, m.index + 800);
    yield { table: m[1], text: src.slice(m.index, end), index: m.index };
    re.lastIndex = m.index + 1;
  }
}

describe("reads on high-volume tables are bounded", () => {
  const files = sourceFiles(ROOT);

  it("scans a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no unbounded SELECT on ad_runs or ad_events", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const c of chains(src)) {
        // Writes are bounded by their own filters, not by row count.
        if (/\.(delete|update|upsert|insert)\(/.test(c.text)) continue;
        const bounded =
          /\.limit\(/.test(c.text) ||
          /\.single\(|\.maybeSingle\(/.test(c.text) ||
          /count:\s*["']exact["']/.test(c.text) ||
          /\.range\(/.test(c.text);
        if (bounded) continue;
        const line = src.slice(0, c.index).split("\n").length;
        offenders.push(`${f.replace(process.cwd() + "/", "")}:${line} (${c.table})`);
      }
    }
    expect(
      offenders,
      `unbounded reads — a truncated prefix becomes a wrong reported number:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
