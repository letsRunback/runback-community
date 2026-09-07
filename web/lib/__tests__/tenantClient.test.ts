/**
 * The org-scoped database client.
 *
 * These tests cover the half that does not need a live database: the token
 * carries the right claims, it is signed with the right secret, it expires, and
 * — most importantly — the fallback to the service-role client is honest about
 * itself. A silent fallback would mean believing the database enforces
 * isolation when it does not, which is precisely the misconception this module
 * exists to remove.
 *
 * What is NOT covered here, deliberately: that the POLICIES filter correctly.
 * That is a property of the database, not of this file, and asserting it
 * against a mock would prove only that the mock agrees with itself. It is
 * verified against the real database after sql/create_tenant_role.sql is
 * applied — see docs/RLS-PLAN.md.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";

const SAVED = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  secret: process.env.SUPABASE_JWT_SECRET,
  flag: process.env.RUNBACK_TENANT_CLIENT,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const ORG = "97a1c898-9906-412d-a558-e0762db7f369";
const SECRET = "test-jwt-secret-value";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.SUPABASE_JWT_SECRET = SECRET;
  // Required since the apikey/Authorization split: apikey identifies the
  // PROJECT and must be a real project key, Authorization carries the tenant.
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-tests";
  delete process.env.RUNBACK_TENANT_CLIENT;
});
afterEach(() => {
  for (const [k, v] of [
    ["NEXT_PUBLIC_SUPABASE_URL", SAVED.url],
    ["SUPABASE_JWT_SECRET", SAVED.secret],
    ["RUNBACK_TENANT_CLIENT", SAVED.flag],
    ["SUPABASE_SERVICE_ROLE_KEY", SAVED.service],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function decode(token: string) {
  const [h, p] = token.split(".");
  const un = (s: string) =>
    JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  return { header: un(h), claims: un(p) };
}

describe("tenant token", () => {
  it("carries the tenant role and the org, and nothing else identifying", async () => {
    const { __test } = await import("@/lib/supabase/tenant");
    const { header, claims } = decode(__test.mintToken(ORG, SECRET));

    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(claims.role).toBe("tenant");
    expect(claims.org_id).toBe(ORG);
    // No user, email or session identity: this is a database credential scoped
    // to one org, not something that speaks for a person.
    expect(Object.keys(claims).sort()).toEqual(["exp", "iat", "org_id", "role"]);
  });

  it("verifies against the signing secret and not against another one", async () => {
    const { __test } = await import("@/lib/supabase/tenant");
    const token = __test.mintToken(ORG, SECRET);
    const [h, p, sig] = token.split(".");

    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(`${h}.${p}`)
      .digest("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(sig).toBe(expected);

    const wrong = crypto
      .createHmac("sha256", "a-different-secret")
      .update(`${h}.${p}`)
      .digest("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(sig).not.toBe(wrong);
  });

  it("expires quickly — it is a per-request credential, not a session", async () => {
    const { __test } = await import("@/lib/supabase/tenant");
    const { claims } = decode(__test.mintToken(ORG, SECRET));
    expect(claims.exp - claims.iat).toBe(__test.TOKEN_TTL_SECONDS);
    expect(__test.TOKEN_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it("gives different orgs different tokens", async () => {
    const { __test } = await import("@/lib/supabase/tenant");
    const a = __test.mintToken(ORG, SECRET);
    const b = __test.mintToken("00000000-0000-0000-0000-000000000001", SECRET);
    expect(a).not.toBe(b);
    expect(decode(b).claims.org_id).not.toBe(ORG);
  });
});

describe("fallback is visible, never silent", () => {
  it("reports usedTenantRole=false when no signing secret is configured", async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const { getTenantClient, tenantIsolationActive } = await import("@/lib/supabase/tenant");
    expect(tenantIsolationActive()).toBe(false);
    expect(getTenantClient(ORG).usedTenantRole).toBe(false);
  });

  it("reports usedTenantRole=false when the kill switch is off", async () => {
    process.env.RUNBACK_TENANT_CLIENT = "off";
    const { getTenantClient, tenantIsolationActive } = await import("@/lib/supabase/tenant");
    expect(tenantIsolationActive()).toBe(false);
    expect(getTenantClient(ORG).usedTenantRole).toBe(false);
  });

  it("reports usedTenantRole=true when it can actually enforce", async () => {
    const { getTenantClient, tenantIsolationActive } = await import("@/lib/supabase/tenant");
    expect(tenantIsolationActive()).toBe(true);
    expect(getTenantClient(ORG).usedTenantRole).toBe(true);
  });

  it("refuses to build a client with no org", async () => {
    // There is no "all orgs" form on purpose: cross-tenant work belongs on the
    // admin client, where reaching for it is a visible decision.
    const { getTenantClient } = await import("@/lib/supabase/tenant");
    expect(() => getTenantClient("")).toThrow(/requires an org id/i);
  });
});

describe("apikey and Authorization are different things", () => {
  /**
   * createClient(url, X) sets X as the `apikey` HEADER. Supabase's gateway
   * rejects any request whose apikey is not a recognised project key, before
   * PostgREST evaluates a single policy — so passing the minted tenant token
   * there failed every read with an auth error, which the callers' .catch()
   * fallbacks turned into empty results. The ledger reported "cannot confirm",
   * /app/runs showed zero runs, and it read as missing data rather than
   * rejected credentials. That cost a production rollback.
   *
   * Asserted by intercepting createClient rather than by unsetting the anon
   * key: NEXT_PUBLIC_* values are inlined at build time, so deleting one at
   * runtime does nothing and a test written that way passes for the wrong
   * reason.
   */
  it("sends the project anon key as apikey, and the tenant token as Authorization", async () => {
    const calls: { key: string; auth: string }[] = [];
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: (_url: string, key: string, opts: { global?: { headers?: Record<string, string> } }) => {
        calls.push({ key, auth: opts?.global?.headers?.authorization ?? "" });
        return {} as never;
      },
    }));
    vi.resetModules();
    try {
    const { getTenantClient } = await import("@/lib/supabase/tenant");
    const out = getTenantClient(ORG);
    expect(out.usedTenantRole).toBe(true);
    expect(calls).toHaveLength(1);

    // The apikey must NOT be the minted token — that is the whole bug.
    expect(calls[0].key).toBe("anon-key-for-tests");
    expect(calls[0].auth.startsWith("Bearer ")).toBe(true);
    expect(calls[0].auth).not.toContain("anon-key-for-tests");

    // And the Authorization token must actually carry this org.
    const payload = JSON.parse(
      Buffer.from(calls[0].auth.replace("Bearer ", "").split(".")[1], "base64url").toString()
    );
    expect(payload.org_id).toBe(ORG);
    expect(payload.role).toBe("tenant");
    } finally {
      // In a finally, not at the end of the body: a failing assertion above
      // would otherwise leave @supabase/supabase-js mocked for whatever runs
      // next in this worker.
      vi.doUnmock("@supabase/supabase-js");
      vi.resetModules();
    }
  });
});
