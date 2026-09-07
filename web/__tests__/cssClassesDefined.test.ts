/**
 * Every semantic class the markup uses must exist in the stylesheet.
 *
 * /demo's "book a live session" form used .form-input and .form-label, and
 * neither was defined anywhere. Nothing failed: the browser applied its own
 * defaults, which inside a dark theme meant no border, transparent background
 * and no padding. Labels sat on top of placeholders and the page rendered
 * "NameYour name" — on the enterprise lead path, for however long it had been
 * that way. A missing class is silent in a way a missing import never is.
 *
 * Scope is deliberately narrow: prefixed component classes, which are ours by
 * construction. Utility and state classes (mono, hide-sm, sr-only, …) and
 * anything built by template interpolation are excluded — this is a smoke
 * detector for "declared but never styled", not a CSS coverage tool.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = join(process.cwd(), "web");
const CSS = readFileSync(join(WEB, "app", "globals.css"), "utf8");

/** Component-class prefixes that must resolve to a rule. */
const TRACKED = /^(form|docs|gs|demo|price|blog|moat|lv|tt|kpi|settings|onb|appc|cost|uc|ft|site|mk|cmp|table)-/;

/** Classes whose styling legitimately lives elsewhere or is state-only. */
const ALLOW = new Set(["mk", "mk-link", "site-cta", "site-nav", "site-header"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

describe("component classes are defined", () => {
  const files = [...sourceFiles(join(WEB, "app")), ...sourceFiles(join(WEB, "components"))];

  const used = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // Only plain string className values — template literals build names at
    // runtime and cannot be checked statically.
    for (const m of src.matchAll(/className="([^"{}]+)"/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls && TRACKED.test(cls) && !ALLOW.has(cls)) used.add(cls);
      }
    }
  }

  it("finds classes to check (guard against an empty scan)", () => {
    expect(used.size).toBeGreaterThan(30);
  });

  it("has a rule for every tracked class", () => {
    const missing = [...used].filter((c) => !CSS.includes(`.${c}`)).sort();
    expect(
      missing,
      `used in markup but never defined in globals.css:\n${missing.join("\n")}`
    ).toEqual([]);
  });
});
