/**
 * An org-scoped database client whose isolation the database enforces.
 *
 * `getAdminClient()` authenticates as `service_role`, which has BYPASSRLS. Every
 * policy in the schema is invisible to it, so tenant isolation on those queries
 * is whatever the call site remembered to write. This codebase has shipped three
 * separate missing-`.eq("org_id", …)` bugs; each type-checked and passed the
 * full suite, because an unscoped read returns *more* data, never an error.
 *
 * This client presents a short-lived JWT carrying `role: "tenant"` and the org.
 * PostgREST validates it, does SET ROLE, and the policies in
 * sql/create_tenant_role.sql filter every row against `current_org_id()` — read
 * from the verified token, not from anything the query says. A forgotten filter
 * then returns ZERO rows instead of another tenant's: the failure inverts from
 * silent over-disclosure to visible under-disclosure.
 *
 * ── Rollout ────────────────────────────────────────────────────────────────
 * Falls back to the admin client, loudly, when it cannot do better — no
 * SUPABASE_JWT_SECRET configured, or RUNBACK_TENANT_CLIENT=off. That keeps the
 * migration reversible per-deploy: the code can ship before the secret exists,
 * and a bad policy can be switched off without a rollback. `usedTenantRole` on
 * the result says which path was taken, so the fallback cannot be mistaken for
 * the real thing in a test or a log.
 *
 * The tokens never leave the server, live 60 seconds, and grant SELECT on eight
 * tables for one org. They are not session tokens and must not be sent to a
 * browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { assertNotExpired } from "@/lib/supabase/keyExpiry";
import crypto from "crypto";

/** How long a minted token is valid. Long enough for one request, not a session. */
const TOKEN_TTL_SECONDS = 60;

/** Cache clients per org — creating one per query would re-sign a JWT each time. */
const cache = new Map<string, { client: SupabaseClient; expiresAt: number }>();

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mint an HS256 JWT in the shape PostgREST expects.
 *
 * Hand-rolled rather than pulling in a JWT library: this is one HMAC over two
 * base64url segments, and the dependency would be a supply-chain surface on the
 * path that issues database credentials.
 */
function mintToken(orgId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      role: "tenant",
      org_id: orgId,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    })
  );
  const data = `${header}.${payload}`;
  const sig = b64url(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

export interface TenantClient {
  client: SupabaseClient;
  /**
   * False when this fell back to service_role. Callers that care about the
   * guarantee — and tests asserting it — must check this rather than assume.
   */
  usedTenantRole: boolean;
}

let warnedOnce = false;

/**
 * A client scoped to one org.
 *
 * @param orgId The tenant. Required: there is no "all orgs" form of this
 *   function on purpose — cross-tenant work belongs on the admin client, where
 *   it is visible.
 */
export function getTenantClient(orgId: string): TenantClient {
  if (!orgId) throw new Error("getTenantClient requires an org id");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_JWT_SECRET;
  const enabled = process.env.RUNBACK_TENANT_CLIENT !== "off";

  if (!url || !secret || !enabled) {
    // Say why, once. A silent fallback would mean believing the database is
    // enforcing isolation while it is not — the precise misconception this
    // module exists to remove.
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        `[tenant] falling back to the service-role client (${
          !enabled ? "RUNBACK_TENANT_CLIENT=off" : "SUPABASE_JWT_SECRET not set"
        }). Reads are NOT enforced by row-level security on this deployment.`
      );
    }
    return { client: getAdminClient(), usedTenantRole: false };
  }

  const hit = cache.get(orgId);
  // Re-mint well before expiry so a token cannot lapse mid-request.
  if (hit && hit.expiresAt > Date.now() + 10_000) {
    return { client: hit.client, usedTenantRole: true };
  }

  const token = mintToken(orgId, secret);
  // The second argument to createClient becomes the `apikey` HEADER, and
  // Supabase's gateway rejects any request whose apikey is not a recognised
  // project key — before PostgREST ever evaluates a policy. Passing the minted
  // token there meant every tenant read failed with an auth error, which the
  // callers' .catch() fallbacks then turned into empty results: the ledger
  // reported "cannot confirm", /app/runs showed zero runs, and it read as
  // missing data rather than rejected credentials.
  //
  // apikey identifies the PROJECT; Authorization carries the caller. They are
  // different things and only the second is ours to vary per tenant. The anon
  // key is safe here: it is public by design (NEXT_PUBLIC_), grants nothing on
  // its own, and every table's RLS still evaluates against the tenant token.
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        "[tenant] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set; falling back to the " +
        "service-role client. Reads are NOT enforced by row-level security."
      );
    }
    return { client: getAdminClient(), usedTenantRole: false };
  }
  // An expired anon key does not degrade — every tenant-scoped read returns
  // 401 and the app shows zero runs, which is exactly the shape of the
  // incident this client exists to prevent. Fail with the reason instead.
  assertNotExpired("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: `Bearer ${token}` } },
  });
  cache.set(orgId, { client, expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000 });
  return { client, usedTenantRole: true };
}

/** Whether this deployment can actually enforce isolation in the database. */
export function tenantIsolationActive(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_JWT_SECRET &&
    // The anon key is required to build the client at all (it is the apikey
    // header). Reporting isolation as active without it would be the exact
    // claim this function exists to make honestly.
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.RUNBACK_TENANT_CLIENT !== "off"
  );
}

/** Exported for tests: verify a minted token without a live database. */
export const __test = { mintToken, TOKEN_TTL_SECONDS };
