/**
 * An expired service-role JWT must fail loudly, not silently.
 *
 * When the token in .env lapses, PostgREST answers 401 (PGRST301) to every
 * query. Sign-in becomes impossible and the only clue is "JWT expired" buried
 * in a server log behind a generic 500 — while the site serves, the database is
 * healthy and every container is up. That combination cost real diagnosis time
 * on a stack that was otherwise correctly configured, and a self-hoster hitting
 * it has far less to go on than we did.
 *
 * The guard reads only the unverified `exp` claim. Verifying the signature
 * needs the secret and is PostgREST's job; the point here is turning a silent,
 * misleading failure into an explicit one that names the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const SAVED = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

/** A JWT with the given exp. Signature is irrelevant — the guard never checks it. */
function tokenWithExp(exp: number): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b({ role: "service_role", exp })}.sig`;
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
});
afterEach(() => {
  if (SAVED.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = SAVED.url;
  if (SAVED.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = SAVED.key;
});

const now = () => Math.floor(Date.now() / 1000);

describe("expired service-role key", () => {
  it("throws, naming the variable and the fix", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = tokenWithExp(now() - 86400 * 3);
    const { getAdminClient } = await import("@/lib/supabase/admin");
    expect(() => getAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY expired/);
    expect(() => getAdminClient()).toThrow(/\.env\.example/);
  });

  it("accepts a token that is still valid", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = tokenWithExp(now() + 86400 * 365);
    const { getAdminClient } = await import("@/lib/supabase/admin");
    expect(() => getAdminClient()).not.toThrow();
  });

  it("accepts a token with no exp claim at all", async () => {
    const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    process.env.SUPABASE_SERVICE_ROLE_KEY = `${b({ alg: "HS256" })}.${b({ role: "service_role" })}.sig`;
    const { getAdminClient } = await import("@/lib/supabase/admin");
    expect(() => getAdminClient()).not.toThrow();
  });

  it("leaves a non-JWT key alone rather than refusing to boot", async () => {
    // Hosted Supabase may issue key formats this cannot parse. Refusing to
    // start over an unrecognised format would be worse than the bug it guards.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_not_a_jwt_at_all";
    const { getAdminClient } = await import("@/lib/supabase/admin");
    expect(() => getAdminClient()).not.toThrow();
  });
});
