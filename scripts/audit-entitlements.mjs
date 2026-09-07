#!/usr/bin/env node
/**
 * Entitlement Gate Auditor
 *
 * Scans every page.tsx under web/app/app/ and enforces one rule:
 *
 *   ERROR  RAW_PLAN_GATE — the page calls can(...) / planBadgeText-style gating
 *                          against a plan value read straight off the `orgs`
 *                          row (or session.rawPlan) instead of session.orgPlan.
 *
 * Why this rule exists
 * --------------------
 * `orgs.plan` is the BILLED plan. It stays "free" for the entire 14-day trial.
 * `session.orgPlan` is the EFFECTIVE plan — featurePlan() resolves an active
 * trial to "pro". Gating a page on the raw column therefore shows an upgrade
 * wall to a trialing org for the exact features its trial is supposed to grant,
 * while the API layer (orgHasFeature, which IS trial-aware) happily allows them.
 * That split-brain shipped once across 12 pages; this check keeps it dead.
 *
 * Sibling of audit-route-guards.mjs, which enforces the same invariant on the
 * API side (routes must use orgHasFeature, never can()).
 *
 * Usage:
 *   node scripts/audit-entitlements.mjs
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_DIR = join(ROOT, "web/app/app");

/** Recursively collect every page.tsx under the authed app shell. */
function pages(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

// A plan value that is NOT trial-aware. Matches the shapes this codebase
// actually produced: can(org?.plan, …), can(orgRow?.plan, …), can(plan, …)
// where `plan` came off an orgs row, and can(session.rawPlan, …).
const RAW_PLAN_ARG = /\bcan\(\s*(org(?:Row)?\??\.plan|session[!?]?\.rawPlan)\b/g;

// `const plan = <something off an orgs row>` — then can(plan, …) is also raw.
const LOCAL_RAW_PLAN =
  /const\s+(\w+)\s*=\s*(?:org(?:Row)?\??\.plan|session[!?]?\.rawPlan)\b/g;

const errors = [];
const files = pages(APP_DIR);

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);

  for (const m of src.matchAll(RAW_PLAN_ARG)) {
    const line = src.slice(0, m.index).split("\n").length;
    errors.push({
      file: `${rel}:${line}`,
      detail: `can(${m[1]}, …) gates on the billed plan, not the effective one. Use can(session!.orgPlan, …) — orgs.plan stays "free" for the whole trial.`,
    });
  }

  // Catch the indirection: const plan = orgRow?.plan  →  can(plan, …)
  for (const m of src.matchAll(LOCAL_RAW_PLAN)) {
    const name = m[1];
    const used = new RegExp(`\\bcan\\(\\s*${name}\\s*,`).exec(src);
    if (used) {
      const line = src.slice(0, used.index).split("\n").length;
      errors.push({
        file: `${rel}:${line}`,
        detail: `can(${name}, …) where \`${name}\` was read off the orgs row. Use can(session!.orgPlan, …) — the trial-aware effective plan.`,
      });
    }
  }
}

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

console.log(`\n${BOLD}Entitlement Gate Audit${RESET} — ${files.length} app pages scanned\n`);

if (errors.length === 0) {
  console.log(`${GREEN}✓ Every page gates on the trial-aware effective plan.${RESET}\n`);
  process.exit(0);
}

for (const e of errors) {
  console.log(`${RED}${BOLD}ERROR${RESET}  [RAW_PLAN_GATE]  ${e.file}`);
  console.log(`       ${e.detail}\n`);
}

console.log(`${errors.length} error(s)\n`);
process.exit(1);
