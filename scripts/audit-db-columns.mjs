#!/usr/bin/env node
/**
 * Code → Database Column Audit
 *
 * Reads every `.from("table").select(...)/.eq(...)/.gte(...)` chain in web/ and
 * probes the live database for each column the code actually asks for.
 *
 * Why this exists (and why check-schema.mjs is not enough)
 * -------------------------------------------------------
 * check-schema.mjs runs the other direction: it derives what SHOULD exist from
 * the migrations in sql/ and confirms the database has it. That catches an
 * unapplied migration. It cannot catch the opposite and far more common bug —
 * code that selects a column no migration ever declared.
 *
 * PostgREST answers a bad column with `{data: null, error}` and HTTP 400. Every
 * call site in this codebase destructures `const { data }` and ignores `error`,
 * so a typo'd column does not throw: it renders an empty page, a zero count, or
 * a silent fallback. That is how the chargeback cron never wrote a row, the
 * regulatory dashboard reported "not_started" against live policies, the PLG
 * 100-run milestone never fired, and the newsletter's fleet signal shipped
 * canned copy every week — all at once, all invisible, all for months.
 *
 * This script turns that class of bug into a red build.
 *
 * Accuracy notes
 * --------------
 * Parsing is heuristic, so it is bounded deliberately:
 *   - a chain's window ENDS at the next `.from(` — the single biggest source of
 *     false positives is one query's columns bleeding into the next one's table
 *   - embedded relations (`users(email)`, `ad_runs!inner(org_id)`) are skipped;
 *     they are joins, not columns
 *   - qualified filters (`.eq("ad_runs.org_id", …)`) are skipped for the same reason
 *   - a `.from(someVariable)` is skipped entirely — nothing to check
 *   - comments are blanked before scanning, so a comment describing an old bug
 *     ("this used to say .from('runs')") is not itself reported as one
 * The bias is toward false negatives. A finding here is real.
 *
 * Usage
 *   node scripts/audit-db-columns.mjs               # uses web/.env.local
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/audit-db-columns.mjs
 *
 * Run it against PRODUCTION too — prod is the database that matters.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIR = join(ROOT, "web");

// ─── Credentials (same resolution order as check-schema.mjs) ─────────────────
function loadEnv() {
  let url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const envFile = join(ROOT, "web/.env.local");
  if ((!url || !key) && existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!url && (k === "SUPABASE_URL" || k === "NEXT_PUBLIC_SUPABASE_URL")) url = v;
      if (!key && k === "SUPABASE_SERVICE_ROLE_KEY") key = v;
    }
  }
  return { url, key };
}

const { url, key } = loadEnv();
if (!url || !key) {
  console.log(
    "\nCode → DB Column Audit — skipped (no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).\n" +
      "Set them, or run from a checkout with web/.env.local present.\n"
  );
  process.exit(0);
}

// ─── Collect source files ────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo"]);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name)) files.push(p);
  }
})(SCAN_DIR);

/**
 * Blank out comments, preserving length so byte offsets and line numbers still
 * line up with the original source.
 *
 * This matters more than it looks: the fix for a bad query usually leaves behind
 * a comment quoting the old query, and without this the auditor would keep
 * reporting the bug it just helped fix. Tracks string and template state so a
 * URL like "https://example.com" is not mistaken for a line comment.
 */
function stripComments(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  let quote = null; // "'" | '"' | "`"

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }

    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }

    if (ch === "/" && next === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      // blank the closing */ too
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }

    i++;
  }
  return out.join("");
}

// ─── Extract every (table, column) the code asks the database for ────────────
/** Filter/ordering methods whose first argument is a column name. */
const COLUMN_ARG_METHODS =
  "eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|order";

/** "table.column" -> Set("web/lib/foo.ts:123") */
const refs = new Map();
/** table -> Set(call sites) — so a missing TABLE reports where it is used. */
const tableSites = new Map();

const addRef = (table, column, where) => {
  const k = `${table}.${column}`;
  if (!refs.has(k)) refs.set(k, new Set());
  refs.get(k).add(where);
};

for (const file of files) {
  const src = stripComments(readFileSync(file, "utf8"));
  const rel = relative(ROOT, file);

  // Precompute line numbers so we can report file:line without re-splitting.
  const lineAt = (index) => src.slice(0, index).split("\n").length;

  const fromRe = /\.from\(\s*["'`]([a-z_0-9]+)["'`]\s*\)/g;
  let m;
  while ((m = fromRe.exec(src))) {
    const table = m[1];
    const where = `${rel}:${lineAt(m.index)}`;

    if (!tableSites.has(table)) tableSites.set(table, new Set());
    tableSites.get(table).add(where);

    // Bound the window at the next `.from(` — a chain never spans two tables.
    // The 400-char cap is a backstop for the last chain in a file.
    const rest = src.slice(m.index + m[0].length);
    const nextFrom = rest.search(/\.from\(/);
    const window = rest.slice(0, nextFrom === -1 ? 400 : Math.min(nextFrom, 400));

    // .select("a,b,alias:c") — only the FIRST select in the window belongs to
    // this chain. `.select("*")` and the count-only form tell us nothing.
    const sel = /\.select\(\s*["'`]([^"'`]*)["'`]/.exec(window);
    if (sel && sel[1] && sel[1].trim() !== "*") {
      for (const rawCol of sel[1].split(",")) {
        let c = rawCol.trim();
        if (!c) continue;
        // Embedded relation — `users(email)`, `ad_runs!inner(org_id)`. A join,
        // not a column on this table.
        if (c.includes("(") || c.includes("!") || c.includes("*")) continue;
        // Aliased column — `alias:real_column`.
        if (c.includes(":")) c = c.split(":")[1].trim();
        if (/^[a-z_0-9]+$/.test(c)) addRef(table, c, where);
      }
    }

    // .eq("col", …) etc. A qualified "ad_runs.org_id" refers to an embedded
    // table and will not match this pattern — which is what we want.
    const filterRe = new RegExp(`\\.(?:${COLUMN_ARG_METHODS})\\(\\s*["'\`]([a-z_0-9]+)["'\`]`, "g");
    for (const f of window.matchAll(filterRe)) addRef(table, f[1], where);

    // .or("col.is.null,other.neq.x") — PostgREST packs several filters into one
    // string, so the column names never appear as a bare first argument and the
    // pattern above walks straight past them. Missed a real one before this.
    for (const o of window.matchAll(/\.or\(\s*[`"']([^`"']+)[`"']/g)) {
      for (const clause of o[1].split(",")) {
        const col = clause.trim().split(".")[0];
        if (/^[a-z_0-9]+$/.test(col)) addRef(table, col, where);
      }
    }

    // Advance by one char, not by the whole match, so back-to-back chains are
    // all visited rather than swallowed by the previous window.
    fromRe.lastIndex = m.index + 1;
  }
}

// ─── Probe the live database ─────────────────────────────────────────────────
const base = url.replace(/\/$/, "");
const headers = { apikey: key, Authorization: `Bearer ${key}` };

/** limit=0 keeps the probe free — we only care about the status code. */
async function probe(table, select) {
  const res = await fetch(
    `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=0`,
    { headers }
  );
  if (res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return body.message || `HTTP ${res.status}`;
}

const allTables = [...tableSites.keys()].sort();
const missingTables = [];
const liveTables = new Set();

for (const t of allTables) {
  const err = await probe(t, "*");
  if (err) missingTables.push({ table: t, err, sites: [...tableSites.get(t)] });
  else liveTables.add(t);
}

const missingColumns = [];
for (const [k, sites] of [...refs].sort()) {
  const [table, column] = k.split(".");
  if (!liveTables.has(table)) continue; // already reported at table level
  const err = await probe(table, column);
  if (err) missingColumns.push({ table, column, err, sites: [...sites] });
}

// ─── Report ──────────────────────────────────────────────────────────────────
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

console.log(
  `\n${BOLD}Code → DB Column Audit${RESET} — ${allTables.length} tables, ` +
    `${refs.size} column references across ${files.length} files`
);
console.log(`${DIM}against ${base.replace(/^https?:\/\//, "")}${RESET}\n`);

for (const t of missingTables) {
  console.log(`${RED}${BOLD}MISSING TABLE${RESET}   ${t.table}`);
  console.log(`${DIM}       ${t.err}${RESET}`);
  for (const s of t.sites) console.log(`${DIM}       ← ${s}${RESET}`);
  console.log();
}

for (const c of missingColumns) {
  console.log(`${RED}${BOLD}MISSING COLUMN${RESET}  ${c.table}.${c.column}`);
  console.log(`${DIM}       ${c.err}${RESET}`);
  for (const s of c.sites) console.log(`${DIM}       ← ${s}${RESET}`);
  console.log();
}

const total = missingTables.length + missingColumns.length;
if (total === 0) {
  console.log(`${GREEN}✓ Every column the code selects exists in the database.${RESET}\n`);
  process.exit(0);
}

console.log(
  `${RED}${total} problem(s)${RESET} — these queries return HTTP 400 at runtime. ` +
    `If the call site ignores \`error\`, it fails silently.\n`
);
process.exit(1);
