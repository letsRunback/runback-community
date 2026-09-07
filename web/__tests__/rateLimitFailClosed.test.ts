/**
 * Which routes must fail CLOSED (deny) rather than degrade to a per-instance
 * limiter when the shared Postgres rate-limit store is unavailable.
 *
 * A red-team pass found this deciding by matching the route's key string
 * against a separate FAIL_CLOSED_PREFIXES list kept in lib/rateLimit.ts: the
 * list read "auth-magic-ip:" while the magic-link route actually passed
 * "magic-ip:", so the startsWith() never matched and the one auth endpoint
 * that sends outbound email silently fell back to the per-instance limiter —
 * bypassable by fanning requests across warm serverless instances — exactly
 * when the shared limiter was degraded. That bug is invisible at runtime: the
 * limiter "works" in normal operation, and only the degraded path is wrong.
 *
 * rateLimit()/rateLimitFailClosed() are now two distinctly-named exports
 * instead of one function plus a hidden string-prefix allowlist, so there is
 * no separate list to drift out of sync with the route — but a developer
 * adding a new sensitive endpoint could still reach for the wrong one, or
 * forget the distinction exists. This test is the backstop: it pins which
 * route keys must call rateLimitFailClosed, and fails if any of them call
 * plain rateLimit instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = join(process.cwd(), "web");

/** Route key prefixes that gate auth or spend money/reputation on an outbound side effect. */
const MUST_FAIL_CLOSED = ["magic-ip", "magic-email", "auth-verify", "exec-unlock"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

describe("rate-limit fail-closed coverage", () => {
  // Map every route key to the function name it's actually called through —
  // rateLimit( or rateLimitFailClosed( — across the whole app + lib tree.
  const callsByKey = new Map<string, Set<string>>();
  for (const f of sourceFiles(join(WEB, "app")).concat(sourceFiles(join(WEB, "lib")))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(rateLimitFailClosed|rateLimit)\(`([a-z-]+):/g)) {
      const [, fn, key] = m;
      if (!callsByKey.has(key)) callsByKey.set(key, new Set());
      callsByKey.get(key)!.add(fn);
    }
  }

  it("finds route keys (guard against an empty scan)", () => {
    expect(callsByKey.size).toBeGreaterThan(5);
  });

  it("every high-value auth endpoint calls rateLimitFailClosed, never plain rateLimit", () => {
    const problems: string[] = [];
    for (const key of MUST_FAIL_CLOSED) {
      const fns = callsByKey.get(key);
      if (!fns) { problems.push(`${key}: no route found calling either function`); continue; }
      if (!fns.has("rateLimitFailClosed")) problems.push(`${key}: never calls rateLimitFailClosed (found: ${[...fns].join(", ")})`);
      if (fns.has("rateLimit")) problems.push(`${key}: ALSO calls plain rateLimit somewhere — must be fail-closed everywhere it's used`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
