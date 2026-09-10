#!/usr/bin/env node
/**
 * Does the extracted Community tree import anything the extractor removed?
 *
 *   node scripts/community-dangling-check.mjs <tree> <manifest>
 *
 * Every path the manifest removes is one some surviving file might still
 * import. That has happened three times, each found by hand — most recently a
 * test that shipped to the public repo importing @/lib/enterprise/billing, a
 * directory the extractor deletes by design, leaving a broken suite for anyone
 * who cloned it.
 *
 * verify-community-build.sh does the thorough version — real tsc, real next
 * build — but takes minutes and must be run deliberately, which is exactly why
 * it wasn't. This is the cheap check that always runs.
 *
 * It matches import SPECIFIERS, not file content. An earlier content-matching
 * version reported five files that merely mention where Enterprise code lives
 * in a comment: five false positives and no real findings, which is worse than
 * no check because it teaches you to ignore the output.
 *
 * It cannot see a transitive break, so it does not replace the full verifier.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const [tree, manifest] = process.argv.slice(2);
if (!tree || !manifest) {
  console.error("usage: community-dangling-check.mjs <tree> <manifest>");
  process.exit(2);
}

/** Removed paths only — swap lines (`a => b`) are renames, not removals. */
const removed = readFileSync(manifest, "utf8")
  .split("\n")
  .map((l) => l.replace(/#.*$/, "").trim())
  .filter((l) => l && !l.includes("=>"));

if (!removed.length) {
  console.error("✗ internal: the manifest yielded no removed paths, so this check");
  console.error("  would pass by doing nothing. Refusing to continue.");
  process.exit(2);
}

/** The specifier forms a source file would actually write for a removed path. */
function specifiers(p) {
  const bare = p.replace(/\.(ts|tsx|js|mjs)$/, "");
  if (bare.startsWith("web/")) {
    const inner = bare.slice("web/".length);
    return [`@/${inner}`, `./${inner}`, bare];
  }
  if (bare.startsWith("packages/")) {
    // packages/replay/src/enterprise -> the published subpath @runback/replay/enterprise
    const m = /^packages\/([^/]+)\/src\/(.+)$/.exec(bare);
    return m ? [`@runback/${m[1]}/${m[2]}`, bare] : [bare];
  }
  return [bare];
}

const SRC = /\.(ts|tsx|js|mjs|cjs)$/;
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === ".next") continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (SRC.test(e)) yield full;
  }
}

const files = [...walk(tree)];
const problems = new Map();

for (const p of removed) {
  const specs = specifiers(p);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const spec of specs) {
      // `from "spec"`, `import("spec")`, `require("spec")` — and any deeper
      // path beneath it, which is equally gone.
      const re = new RegExp(
        `(?:from|import|require)\\s*\\(?\\s*["'\`]${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/[^"'\`]*)?["'\`]`
      );
      if (re.test(src)) {
        if (!problems.has(p)) problems.set(p, new Set());
        problems.get(p).add(relative(tree, f));
      }
    }
  }
}

if (problems.size) {
  for (const [p, fs] of problems) {
    console.error(`✗ removed "${p}" is still imported by:`);
    for (const f of fs) console.error(`    ${f}`);
  }
  console.error("");
  console.error("✗ The Community tree imports files it does not contain.");
  console.error("  Add the referencing file to scripts/community-exclude.txt, or stop");
  console.error("  it importing an Enterprise module. Nothing was pushed.");
  process.exit(1);
}
console.log(`  ${files.length} source files checked against ${removed.length} removed paths — clean.`);
