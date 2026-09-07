#!/usr/bin/env node
/**
 * Route Guard Auditor
 *
 * Scans every route.ts under web/app/api/ and enforces three rules:
 *
 *   ERROR   MISSING_AUTH      — route has no session/api-key/cron auth and is
 *                               not in the explicit EXEMPT list below.
 *   ERROR   LEGACY_GATE       — route imports `can` from entitlements directly;
 *                               all plan checks in routes must use orgHasFeature()
 *                               (trial-aware, reads live plan from DB).
 *   WARNING MISSING_RATE_LIMIT — explicitly-public route has no rateLimit() call.
 *
 * Usage:
 *   node scripts/audit-route-guards.mjs          # check + report
 *   node scripts/audit-route-guards.mjs --strict  # exit 1 on warnings too
 *
 * Add to package.json scripts: "guard": "node ../scripts/audit-route-guards.mjs"
 * Add to CI:  node scripts/audit-route-guards.mjs
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT  = fileURLToPath(new URL("..", import.meta.url));
const API_DIR = join(ROOT, "web/app/api");
const STRICT = process.argv.includes("--strict");

// ─── Exempt list ─────────────────────────────────────────────────────────────
// Every entry needs a reason. This list IS the audit trail for "why is this
// route public?" — a reviewer can grep for a path and read the justification.
//
// Auth patterns that make a route exempt without being in this list:
//   getSession()       — standard user session
//   resolveApiKey()    — SDK / OTEL ingest (Bearer key)
//   CRON_SECRET check  — scheduled jobs (checked via Bearer in cron routes)
//   cronAuthorized()   — same, factored into lib/cronAuth.ts's constant-time check
//   resolveScimKey()   — SCIM 2.0 provisioning (scim-scoped Bearer key)
// ─────────────────────────────────────────────────────────────────────────────
const EXEMPT = new Map([
  // ── Operational / transparency endpoints — deliberately public ────────────
  ["app/api/health/route.ts",              "public: liveness/readiness probe for load balancers and uptime monitors — exposes no internals"],
  ["app/api/transparency/route.ts",        "public: append-only transparency log feed — must be readable by outside archivers to constrain us, per file header"],
  ["app/api/transparency/witness/route.ts","public: RFC 3161 time-stamp token download — the claim it supports (externally anchored) is public by design, per file header"],

  // ── SCIM 2.0 discovery — RFC 7644 §4 requires these reachable pre-auth;
  //    they serve only static schema/capability metadata, never tenant data ──
  ["app/api/scim/v2/ServiceProviderConfig/route.ts", "public: SCIM discovery — static capability document, no tenant data (RFC 7644 §4)"],
  ["app/api/scim/v2/Schemas/route.ts",               "public: SCIM discovery — static attribute schema, no tenant data (RFC 7644 §4)"],
  ["app/api/scim/v2/ResourceTypes/route.ts",         "public: SCIM discovery — static resource-type list, no tenant data (RFC 7644 §4)"],
  ["app/api/scim/v2/Groups/route.ts",                "public: SCIM Groups not implemented — returns a SCIM-shaped 404 so IdP clients get the expected content type instead of Next's HTML 404"],
  ["app/api/scim/v2/Groups/[id]/route.ts",           "public: SCIM Groups not implemented — same as Groups/route.ts"],

  // ── Auth flow — no session exists yet ──────────────────────────────────────
  ["app/api/auth/magic/route.ts",        "public: magic-link initiation — no session yet"],
  ["app/api/auth/verify/route.ts",       "public: magic-link token verification — exchanges token for session"],
  ["app/api/auth/logout/route.ts",       "public: clears session cookie — no auth needed to log out"],
  ["app/api/auth/demo/route.ts",         "public: demo-mode auto-login — guarded by RUNBACK_DEMO_MODE flag"],
  ["app/api/auth/sso/start/route.ts",    "public: OIDC flow initiation — org looked up by email domain, no session"],
  ["app/api/auth/sso/callback/route.ts", "public: OIDC callback — state+nonce CSRF; session created here"],
  ["app/api/auth/sso/check/route.ts",    "public: returns whether a domain has SSO configured (no PII exposed)"],

  // ── Webhook — LemonSqueezy HMAC signature verification, not session ────────
  ["app/api/billing/webhook/route.ts",   "webhook: LemonSqueezy HMAC signature verified before any action"],

  // ── Public utility endpoints ───────────────────────────────────────────────
  ["app/api/audit/verify/route.ts",      "public: tamper-evident record verifier — by design no account required"],
  ["app/api/trust/verify/route.ts",      "public: trust-chain verifier — intentional, documented in file header"],
  ["app/api/leads/route.ts",             "public: marketing lead-capture form"],
  ["app/api/demo/book/route.ts",         "public: demo scheduling form"],
  ["app/api/quickstart/route.ts",        "public: serves a curl-able bash quickstart script"],
  ["app/api/exec-unlock/route.ts",       "public: password-gated demo deck unlock (EXEC_PASSWORD env var)"],

  // ── Delegating alias — auth happens in the handler it forwards to ─────────
  ["app/api/runs/[run_id]/replay/route.ts", "alias: forwards to POST /api/replay with headers intact; that handler authenticates"],

  // ── Newsletter ─────────────────────────────────────────────────────────────
  ["app/api/newsletter/subscribe/route.ts",   "public: newsletter opt-in (rate-limited)"],
  ["app/api/newsletter/unsubscribe/route.ts", "public: newsletter opt-out (rate-limited + optional HMAC token)"],
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const e of entries) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (e === "route.ts") files.push(full);
  }
  return files;
}

function relKey(full) {
  return relative(join(ROOT, "web"), full).replaceAll("\\", "/");
}

const AUTH_PATTERNS = [
  /getSession\s*\(/,
  // Dual credential: session cookie OR `Authorization: Bearer rb_live_…`.
  // This is what the routes documented in /docs as a Bearer-token API use.
  /getCaller\s*\(/,
  /resolveApiKey\s*\(/,
  /CRON_SECRET/,
  // Scheduled jobs whose Bearer/CRON_SECRET check was factored into a shared,
  // constant-time helper (lib/cronAuth.ts) — the literal string CRON_SECRET no
  // longer appears in the route file itself, only inside that helper.
  /cronAuthorized\s*\(/,
  // SCIM 2.0 provisioning: a scim-scoped Bearer key, resolved separately from
  // the general-purpose resolveApiKey() (lib/apiKeys.resolveScimKey).
  /resolveScimKey\s*\(/,
  // Narrow-scope credential: a compliance_read key resolves to exactly one
  // route and grants nothing else (see lib/apiKeys.resolveComplianceKey).
  /resolveComplianceKey\s*\(/,
  // Signed one-click links (unsubscribe): the HMAC over the email IS the
  // credential — these must work for a logged-out recipient, and both routes
  // hard-fail with 503 when no signing key is configured rather than falling
  // open. Required by EU ePrivacy / UK PECR.
  //
  // Matches both the inline form and lib/unsubscribeToken's verifyUnsubscribe.
  // Factoring the HMAC into that helper is what made this rule stop matching
  // and flagged plg-unsubscribe as unauthenticated — the check had moved, not
  // disappeared.
  /createHmac\s*\(/,
  /verifyUnsubscribe\s*\(/,
];

const RATE_LIMIT_PATTERN = /rateLimit\s*\(/;

// Detects: import { can } from "@/lib/entitlements"  OR  import { can, ... }
// Intentionally simple — false positives are fine (we want to catch any direct import).
const LEGACY_GATE_PATTERN = /import\s*\{[^}]*\bcan\b[^}]*\}\s*from\s*["']@\/lib\/entitlements["']/;

// ─── Audit ────────────────────────────────────────────────────────────────────

const routes = walk(API_DIR);
const errors   = [];
const warnings = [];

for (const full of routes) {
  const key     = relKey(full);
  const src     = readFileSync(full, "utf8");
  const exempt  = EXEMPT.has(key);
  const hasAuth = AUTH_PATTERNS.some((p) => p.test(src));

  // ERROR 1: no auth + not exempt
  if (!hasAuth && !exempt) {
    errors.push({
      file: key,
      rule: "MISSING_AUTH",
      detail: "Route has no getSession(), resolveApiKey(), or CRON_SECRET check. " +
              "Add auth or add it to the EXEMPT list in scripts/audit-route-guards.mjs with a reason.",
    });
  }

  // ERROR 2: legacy can() import in a route file
  if (LEGACY_GATE_PATTERN.test(src)) {
    errors.push({
      file: key,
      rule: "LEGACY_GATE",
      detail: "Route imports can() from entitlements directly. " +
              "Replace with orgHasFeature() from @/lib/planGate — it is trial-aware and reads the live DB plan.",
    });
  }

  // WARNING: explicitly-public route with no rate limiting
  if (exempt && !RATE_LIMIT_PATTERN.test(src)) {
    warnings.push({
      file: key,
      rule: "MISSING_RATE_LIMIT",
      detail: `Public route has no rateLimit() call. ` +
              `Reason for exemption: "${EXEMPT.get(key)}". ` +
              `Add rate limiting or document why it is not needed.`,
    });
  }
}

// ─── Documented-route check ───────────────────────────────────────────────────
//
// /docs publishes an API reference table and copy-pasteable curl examples. Two
// of the endpoints in it did not exist at all (GET /api/runs returned 404, and
// POST /api/runs/:id/replay was never implemented), and every Runs / Approvals /
// Incidents route it listed under "All API requests require a Bearer token"
// actually accepted only a session cookie.
//
// Nothing caught that, because nothing compared the documentation to the routes.
// This does: every path the docs page names must resolve to a real route file,
// and any route the docs present as Bearer-authenticated must use getCaller().

const DOCS_PAGE = join(ROOT, "web/app/docs/page.tsx");

// Documented paths that are deliberately a BASE, not an endpoint — an SDK
// appends the rest. Each needs a reason, same convention as EXEMPT.
//
// Deliberately NOT a general "some deeper route exists, so this is fine" rule:
// that would have masked the very bug this check was written for. GET /api/runs
// 404'd while /api/runs/[run_id] existed, so prefix matching would have called
// it satisfied.
const DOCS_BASE_PATHS = new Map([
  ["/api/otel", "OTLP base endpoint — exporters append /v1/traces themselves"],
]);

function auditDocumentedRoutes() {
  let docsSrc;
  try {
    docsSrc = readFileSync(DOCS_PAGE, "utf8");
  } catch {
    return; // docs page moved or absent — nothing to check
  }

  // Paths appear in the reference tables as ["GET", "/api/runs", "…"] and in
  // curl examples as https://runback.dev/api/... — collect both.
  const documented = new Set();
  for (const m of docsSrc.matchAll(/["'`](\/api\/[a-zA-Z0-9/_:\-{}[\]]*)["'`]/g)) documented.add(m[1]);
  for (const m of docsSrc.matchAll(/runback\.dev(\/api\/[a-zA-Z0-9/_:\-{}[\]]*)/g)) documented.add(m[1]);

  for (const raw of [...documented].sort()) {
    if (DOCS_BASE_PATHS.has(raw)) continue;
    // Normalise the docs' placeholder styles to the App Router's directory form:
    //   /api/runs/:id/audit  and  /api/runs/{run_id}/audit  ->  /api/runs/[x]/audit
    const segments = raw
      .replace(/\?.*$/, "")
      .split("/")
      .filter(Boolean)
      .map((s) => (s.startsWith(":") || /^\{.*\}$/.test(s) ? "*" : s));

    // Does a route file exist whose path matches, treating [param] as a wildcard?
    const matched = routes.some((full) => {
      const parts = relKey(full).replace(/^app\//, "").replace(/\/route\.ts$/, "").split("/").filter(Boolean);
      if (parts.length !== segments.length) return false;
      return parts.every((p, i) => segments[i] === "*" || /^\[.*\]$/.test(p) || p === segments[i]);
    });

    if (!matched) {
      errors.push({
        rule: "DOCUMENTED_ROUTE_MISSING",
        file: "app/docs/page.tsx",
        detail:
          `/docs documents "${raw}" but no route file implements it. ` +
          `A reader following the documentation gets a 404. Implement it or correct the docs.`,
      });
    }
  }

  // Every route the docs list under the Bearer-token API must accept a key.
  const bearerClaimed = docsSrc.includes("require a Bearer token");
  if (bearerClaimed) {
    for (const full of routes) {
      const key = relKey(full);
      const apiPath = "/" + key.replace(/^app\//, "").replace(/\/route\.ts$/, "");
      const generic = apiPath.replace(/\[[^\]]+\]/g, "*");
      const isDocumented = [...documented].some((d) => {
        const norm = d.replace(/\?.*$/, "").replace(/:[a-zA-Z_]+|\{[^}]+\}/g, "*");
        return norm === generic;
      });
      if (!isDocumented) continue;
      const src = readFileSync(full, "utf8");
      // resolveApiKey counts too — a route that resolves a Bearer key directly
      // (the cassette download does) already honours the documented contract.
      const acceptsKey = /getCaller\s*\(/.test(src) || /resolveApiKey\s*\(/.test(src);
      if (/getSession\s*\(/.test(src) && !acceptsKey) {
        errors.push({
          rule: "DOCUMENTED_ROUTE_SESSION_ONLY",
          file: key,
          detail:
            `/docs presents this route as Bearer-token authenticated, but it only calls getSession() ` +
            `(cookie-only). An API key gets 401. Use getCaller() from lib/apiAuth.`,
        });
      }
    }
  }
}

auditDocumentedRoutes();

// ─── Report ───────────────────────────────────────────────────────────────────

const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN  = "\x1b[32m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

console.log(`\n${BOLD}Route Guard Audit${RESET} — ${routes.length} routes scanned\n`);

if (errors.length === 0 && warnings.length === 0) {
  console.log(`${GREEN}✓ All routes pass.${RESET}\n`);
  process.exit(0);
}

for (const e of errors) {
  console.log(`${RED}${BOLD}ERROR${RESET}  [${e.rule}]  ${e.file}`);
  console.log(`       ${e.detail}\n`);
}

for (const w of warnings) {
  console.log(`${YELLOW}${BOLD}WARN${RESET}   [${w.rule}]  ${w.file}`);
  console.log(`       ${w.detail}\n`);
}

console.log(`${errors.length} error(s)  ${warnings.length} warning(s)\n`);

if (errors.length > 0 || (STRICT && warnings.length > 0)) {
  process.exit(1);
}
