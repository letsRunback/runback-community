/**
 * Every source path named in LICENSING.md must exist.
 *
 * The Key-files column is the auditable statement of where the Community /
 * Commercial line falls — it is the document a licensee reads to check what
 * they are and aren't allowed to run. It has gone stale twice: Phase 2 moved
 * `web/lib/{alerts,billing}.ts` under `web/lib/enterprise/`, and Phase 1 moved
 * `native.ts` and `envCapture.ts` into `enterprise/` subdirectories, while the
 * document kept naming the old locations. Nothing failed — a licence boundary
 * pointing at files that don't exist just quietly stops meaning anything.
 *
 * Paths are resolved against the FULL repository. In the extracted Community
 * tree the commercial files are absent on purpose — excluding them is what
 * makes that tree Community-only — so there the existence check is skipped
 * rather than failed. `web/lib/enterprise/` is the marker: it is the largest
 * directory the extractor removes, so its absence identifies the edition
 * without the test needing to know the manifest.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `a/{b,c}.ts` → ["a/b.ts", "a/c.ts"]. One level is all the document uses. */
function expandBraces(p: string): string[] {
  const m = /^(.*)\{([^}]+)\}(.*)$/.exec(p);
  if (!m) return [p];
  return m[2].split(",").map((part) => `${m[1]}${part.trim()}${m[3]}`);
}

/** `web/app/api/golden/*` is satisfied by the directory existing. */
function resolves(p: string): boolean {
  const bare = p.replace(/\/\*+$/, "");
  return existsSync(join(ROOT, bare));
}

/**
 * Split a cell on its top-level commas only. Splitting naively tears
 * `enterprise/{hybrid,fromEvents}.ts` into two non-paths, which is what made
 * the first version of this test fail against a document that was correct.
 */
function splitOutsideBraces(cell: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of cell) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function citedPaths(): string[] {
  const md = readFileSync(join(ROOT, "LICENSING.md"), "utf8");
  const out = new Set<string>();
  for (const line of md.split("\n")) {
    // Key-files cells only: table rows. Prose cites bare filenames
    // ("see minPlanFor() in entitlements.ts") that are deliberately informal.
    if (!line.startsWith("|")) continue;
    for (const [, code] of line.matchAll(/`([^`]+)`/g)) {
      for (const piece of splitOutsideBraces(code)) {
        const t = piece.trim();
        // Path-shaped only: must contain a slash, and no spaces or parens
        // (excludes `projectInput` / `key_projection` style symbol names).
        if (!t.includes("/") || /[\s()]/.test(t)) continue;
        for (const e of expandBraces(t)) out.add(e);
      }
    }
  }
  return [...out];
}

const IS_FULL_TREE = existsSync(join(ROOT, "web/lib/enterprise"));

describe("LICENSING.md key files", () => {
  const paths = citedPaths();

  it("cites a meaningful number of paths (the extractor itself works)", () => {
    expect(paths.length).toBeGreaterThan(30);
  });

  it.skipIf(!IS_FULL_TREE)("every cited path exists in the full repository", () => {
    const missing = paths.filter((p) => !resolves(p));
    expect(missing, `LICENSING.md names paths that no longer exist:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  // Guards the guard. If the marker directory is ever renamed, IS_FULL_TREE
  // goes false in the private repo too and the check above silently stops
  // running — the exact silent-degradation failure this file exists to catch.
  it("recognises which edition it is running in", () => {
    const communityOnly = !existsSync(join(ROOT, "scripts", "community-exclude.txt"));
    expect(IS_FULL_TREE, "enterprise/ present but the exclude manifest is missing (or vice versa) — the edition marker is wrong").toBe(!communityOnly);
  });
});
