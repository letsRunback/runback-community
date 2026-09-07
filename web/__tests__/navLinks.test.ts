/**
 * Every internal link must resolve in the build it ships in.
 *
 * The Community build drops whole route directories, and nothing connected
 * that fact to the links pointing at them: the app shell's primary nav offered
 * Alerts, Benchmark and Regulatory, and ~12 pages linked to /pricing or
 * /app/upgrade, none of which exist there. A self-hoster's sidebar led to 404s.
 *
 * This is a source-level check because the failure is invisible otherwise —
 * a dead link renders perfectly, and only 404s when someone clicks it. It runs
 * in both builds and checks the routes actually present in whichever one it is,
 * so the Community tree fails here if an exclusion outruns its links again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { routeAvailable } from "@/lib/edition";

const WEB = join(__dirname, "..");
const APP = join(WEB, "app");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

/** Does `/a/b` correspond to a real route directory, static or dynamic? */
function routeExists(href: string): boolean {
  const segments = href.split("/").filter(Boolean);
  let dir = APP;
  for (const seg of segments) {
    if (existsSync(join(dir, seg))) {
      dir = join(dir, seg);
      continue;
    }
    // A dynamic segment ([slug], [run_id], …) matches anything.
    const dynamic = existsSync(dir)
      ? readdirSync(dir).find((e) => e.startsWith("[") && statSync(join(dir, e)).isDirectory())
      : undefined;
    if (!dynamic) return false;
    dir = join(dir, dynamic);
  }
  return existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"));
}

describe("internal links", () => {
  const files = sourceFiles(APP).concat(sourceFiles(join(WEB, "components")));
  const found: { file: string; href: string }[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/href="(\/[a-zA-Z0-9/_-]*)"/g)) {
      found.push({ file: f.replace(WEB + "/", ""), href: m[1] });
    }
  }

  it("finds links to check (guard against an empty scan)", () => {
    expect(found.length).toBeGreaterThan(20);
  });

  it("every hard-coded internal link resolves in this build", () => {
    const dead = found
      // Routes the edition layer knows are absent are checked by the NEXT test
      // instead — it verifies they actually go through EditionLink rather than
      // assuming it, which is what this filter used to do wrong.
      .filter(({ href }) => routeAvailable(href))
      .filter(({ href }) => !routeExists(href))
      .map(({ file, href }) => `${href}  (${file})`);
    expect(
      [...new Set(dead)],
      "these hrefs point at routes that don't exist in this build — either the " +
        "route was excluded (add it to lib/edition.community.ts and use " +
        "EditionLink / PRICING_HREF / UPGRADE_HREF) or the link is a typo"
    ).toEqual([]);
  });
});

/**
 * Routes excluded from some builds must be REACHED through the edition layer.
 *
 * The test above filters those routes out before checking, on the assumption
 * that every call site wraps them in EditionLink or routes them through
 * UPGRADE_HREF/PRICING_HREF. Nothing verified that assumption, and it was false
 * in five places at once — most visibly GateOverlay, whose "See plans" button
 * is the primary control on roughly a dozen locked pages and pointed straight
 * at a 404 in the Community build.
 *
 * So this checks the thing the other test assumes. It also matches string
 * literals rather than href="..." specifically, because two of the misses were
 * invisible to that pattern: a query string (/app/upgrade?plan=scale) and
 * object literals (href: "/app/alerts" in a config array rendered elsewhere).
 */
describe("edition-gated routes", () => {
  const GATED = ["/pricing", "/app/upgrade", "/app/alerts", "/app/benchmark", "/app/regulatory"];
  // The edition modules and the link component itself must name these routes.
  const ALLOWED = /lib\/edition(\.community)?\.ts$|components\/EditionLink\.tsx$|__tests__\//;

  /**
   * Files allowed to name a gated route as data, each with the reason and each
   * REQUIRED to prove it below. A bare allow-list would rot the moment someone
   * removed the filter; pairing each entry with "must also call routeAvailable"
   * means the exemption dies with the thing that justified it.
   */
  const DECLARES_THEN_FILTERS: Record<string, string> = {
    "app/app/layout.tsx": "sidebar nav array — filtered through routeAvailable before render",
    "app/app/StageMap.tsx": "stage item arrays — filtered through routeAvailable before render",
    "app/app/settings/page.tsx": "tools grid array — filtered through routeAvailable before render",
    "app/app/get-started/page.tsx": "ecosystem sinks — filtered through routeAvailable before render",
  };
  /** Files that legitimately name these routes for reasons other than linking. */
  const NOT_A_LINK: Record<string, string> = {
    "app/app/GateOverlay.tsx": "the resolver itself — it must compare against /pricing to rewrite it",
    "app/pricing/page.tsx": "the excluded page's own source; absent in builds that exclude it",
    "components/site/PageJourney.tsx": "step labels only; the trail no longer renders links",
  };

  const offenders: string[] = [];
  const unproven: string[] = [];
  for (const f of sourceFiles(APP).concat(sourceFiles(join(WEB, "components")), sourceFiles(join(WEB, "lib")))) {
    const rel = f.replace(WEB + "/", "");
    if (ALLOWED.test(rel)) continue;
    const src = readFileSync(f, "utf8");
    if (NOT_A_LINK[rel]) continue;
    if (DECLARES_THEN_FILTERS[rel]) {
      // Prove the claim rather than trusting the list.
      if (!/routeAvailable\s*\(/.test(src)) unproven.push(`${rel} — claims to filter but never calls routeAvailable()`);
      continue;
    }
    for (const route of GATED) {
      // The literal, optionally followed by a query/hash, as a whole path
      // segment — so "/app/alerts" matches but "/app/alertsomething" does not.
      const re = new RegExp(`["'\`]${route}(?![a-zA-Z0-9_-])[^"'\`]*["'\`]`, "g");
      for (const m of src.matchAll(re)) {
        // Accept it only if the enclosing JSX tag is <EditionLink>.
        const before = src.slice(0, m.index);
        const tagStart = before.lastIndexOf("<");
        const tag = tagStart >= 0 ? before.slice(tagStart, tagStart + 14) : "";
        if (tag.startsWith("<EditionLink")) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${rel}:${line}  ${m[0]}`);
      }
    }
  }

  it("finds source to scan (guard against a vacuous test)", () => {
    expect(sourceFiles(APP).length).toBeGreaterThan(20);
  });

  it("every file claiming to filter gated routes actually does", () => {
    expect(unproven, "the exemption is only valid while the filter exists").toEqual([]);
  });

  it("never links a build-excluded route without going through the edition layer", () => {
    expect(
      offenders,
      "these hard-code a route that some builds exclude. Use <EditionLink>, or " +
        "UPGRADE_HREF / PRICING_HREF from lib/edition, so the Community build " +
        "degrades instead of serving a 404."
    ).toEqual([]);
  });
});
