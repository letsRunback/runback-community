#!/usr/bin/env node
/**
 * Schema Drift Check
 *
 * Reads every migration in sql/, derives the tables and columns the code expects
 * to exist, and probes the live database for each one. Reports anything missing.
 *
 * Why this exists
 * ---------------
 * There is no migration runner and no applied-migrations table: files in sql/
 * are applied by hand in the Supabase SQL editor. That is workable, but nothing
 * verified it had been done — and six migrations silently went unapplied,
 * breaking ingest, magic-link login, the multi-agent graph, PLG unsubscribe, the
 * public determinism proof, and compliance caching. Every one of them presented
 * as an empty page or a false success rather than an error, because PostgREST
 * returns `{data: null, error}` and the call sites ignored `error`.
 *
 * This script turns "silently broken for weeks" into "CI is red".
 *
 * Usage
 *   node scripts/check-schema.mjs                    # uses web/.env.local
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-schema.mjs
 *
 * Run it against PRODUCTION too — the whole point is catching a database that
 * has drifted from the repo, and prod is the one that matters.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SQL_DIR = join(ROOT, "sql");

// ─── Credentials ─────────────────────────────────────────────────────────────
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

// ─── Self-host mount check (runs with or without credentials) ────────────────
//
// sql/ is applied by hand on the hosted database, but a self-host gets its
// schema exclusively from the file list in docker-compose.yml. That list is
// maintained by hand too, so a new migration silently reaches production while
// every `docker compose up` deployment never sees it. add_adversarial_provenance
// went missing exactly this way, which left the release gate returning 404 on
// every self-hosted install.
function checkComposeMounts() {
  const composePath = join(ROOT, "docker-compose.yml");
  if (!existsSync(composePath)) return [];
  const compose = readFileSync(composePath, "utf8");
  const mounted = new Set([...compose.matchAll(/\.\/sql\/([a-z_0-9]+\.sql)/g)].map((m) => m[1]));
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith(".sql"))
    // verify_*.sql files are read-only proofs meant to be pasted into the SQL
    // editor by hand (see sql/verify_tenant_policies.sql's own header) — not
    // schema migrations, so a self-host mounting them would do nothing.
    .filter((f) => !f.startsWith("verify_"))
    .filter((f) => !mounted.has(f));
}

const unmounted = checkComposeMounts();
if (unmounted.length) {
  console.log(
    `\n\x1b[31m\x1b[1mSelf-host schema gap\x1b[0m — ${unmounted.length} migration(s) in sql/ are not mounted in docker-compose.yml:\n`
  );
  for (const f of unmounted) console.log(`  \x1b[31m✗\x1b[0m sql/${f}`);
  console.log(
    `\nA self-hosted database never runs these. Add each to the db service's volume list.\n`
  );
  process.exit(1);
}

const { url, key } = loadEnv();
if (!url || !key) {
  console.log(
    "\nSchema Drift Check — skipped (no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).\n" +
      "Set them, or run from a checkout with web/.env.local present.\n"
  );
  process.exit(0);
}

// ─── What the repo expects ───────────────────────────────────────────────────
const tables = new Set();
const columns = new Set(); // "table.column"

for (const file of readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"))) {
  const sql = readFileSync(join(SQL_DIR, file), "utf8");

  for (const m of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)/gi
  )) {
    tables.add(m[1].toLowerCase());
  }

  // One ALTER may add several columns:  ALTER TABLE t ADD COLUMN a …, ADD COLUMN b …;
  for (const m of sql.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)([\s\S]*?);/gi
  )) {
    const table = m[1].toLowerCase();
    for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gi)) {
      columns.add(`${table}.${c[1].toLowerCase()}`);
    }
  }
}

// ─── Probe the live database ─────────────────────────────────────────────────
const base = url.replace(/\/$/, "");
const headers = { apikey: key, Authorization: `Bearer ${key}` };

/** Ask PostgREST for one row of `select`; a missing table/column comes back 4xx. */
async function probe(table, select) {
  const res = await fetch(
    `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`,
    { headers }
  );
  if (res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return body.message || `HTTP ${res.status}`;
}

const missingTables = [];
const missingColumns = [];

for (const t of [...tables].sort()) {
  const err = await probe(t, "*");
  if (err) missingTables.push({ name: t, err });
}

for (const tc of [...columns].sort()) {
  const [t, c] = tc.split(".");
  // Skip columns on a table we already know is absent — one error is enough.
  if (missingTables.some((m) => m.name === t)) continue;
  const err = await probe(t, c);
  if (err) missingColumns.push({ name: tc, err });
}

// ─── Report ──────────────────────────────────────────────────────────────────
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const host = base.replace(/^https?:\/\//, "");
console.log(
  `\n${BOLD}Schema Drift Check${RESET} — ${tables.size} tables, ${columns.size} added columns` +
    `\n${DIM}against ${host}${RESET}\n`
);

if (!missingTables.length && !missingColumns.length) {
  console.log(`${GREEN}✓ Database matches every migration in sql/.${RESET}\n`);
  process.exit(0);
}

for (const t of missingTables) {
  console.log(`${RED}${BOLD}MISSING TABLE${RESET}   ${t.name}`);
  console.log(`               ${DIM}${t.err}${RESET}\n`);
}
for (const c of missingColumns) {
  console.log(`${RED}${BOLD}MISSING COLUMN${RESET}  ${c.name}`);
  console.log(`               ${DIM}${c.err}${RESET}\n`);
}

console.log(
  `${missingTables.length} missing table(s), ${missingColumns.length} missing column(s).\n` +
    `Apply the matching file(s) in sql/ to this database, then re-run.\n`
);
process.exit(1);
