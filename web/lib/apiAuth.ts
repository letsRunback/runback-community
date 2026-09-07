/**
 * Dual authentication for the public REST API.
 *
 * Why this exists
 * ---------------
 * /docs opens its API reference with "All API requests require a Bearer token in
 * the Authorization header" and then documents the Runs, Approvals, and
 * Incidents endpoints. None of that was true: every one of those routes called
 * `getSession()`, which reads the session cookie and nothing else. A customer
 * following the documentation to the letter got 401 on every call, and Bearer
 * keys worked on exactly four routes (ingest, OTel, cassette, evidence-summary).
 *
 * `getCaller()` accepts either credential and normalises them, so a route can be
 * written once and serve the dashboard and the documented API equally.
 *
 * Identity and authority
 * ----------------------
 * A session carries a real person: their email and their org role. An API key
 * carries an org and the email of whoever minted it, but no human actor — so:
 *
 *   - `via` records which credential was used, and every route that writes an
 *     actor into an audit trail must pass it through. An approval decided by a
 *     CI key must never be indistinguishable from one a person clicked.
 *   - keys resolve to `admin`, not `owner`. They are server-side secrets an
 *     owner deliberately created, so admin-level automation is the point; but
 *     owner-only actions (billing, deleting the org, rotating keys) stay
 *     human-only, and a leaked key cannot escalate to them.
 *
 * Scope
 * -----
 * Only `ingest`-scoped keys (the `rb_live_` SDK key from Settings) authenticate
 * here. `compliance_read` keys are deliberately confined to one endpoint and are
 * rejected — see resolveComplianceKey in lib/apiKeys.ts.
 */
import crypto from "crypto";
import { getSession, type Role } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { tryWrite } from "@/lib/supabase/write";

export interface Caller {
  orgId: string;
  /** Actor identity: the signed-in user, or the email that owns the API key. */
  email: string;
  /** null for API keys — there is no user behind them. */
  userId: string | null;
  role: Role;
  via: "session" | "api_key";
}

/** Pull a Bearer token out of the Authorization header, if there is one. */
function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/**
 * Resolve an `rb_live_` API key to its org and owner.
 *
 * Deliberately separate from resolveApiKey() in lib/ingest.ts: that one is the
 * ingest hot path and returns a projectId, and it should not grow fields for
 * this. Both hash the raw key the same way and check the same active/expiry/
 * scope conditions.
 */
async function resolveKeyCaller(rawKey: string): Promise<Caller | null> {
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const { data, error } = await sb
    .from("api_keys")
    .select("id, org_id, owner_email, expires_at, scope, active")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("[apiAuth] key lookup failed:", error.message);
    return null;
  }
  if (!data?.org_id) return null;

  // compliance_read (and any future narrow scope) must not reach the general API.
  if (data.scope && data.scope !== "ingest") return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Best-effort last-used stamp; deliberately not awaited so it never adds
  // latency to an authenticated request. Routed through tryWrite so a failure is
  // logged rather than swallowed by a bare `.then(() => {})` — the .catch covers
  // the case where the client rejects outright instead of returning { error }.
  tryWrite(
    sb.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id),
    "stamp api key last_used_at"
  ).catch((e) => console.error("[apiAuth] last_used_at stamp threw:", e));

  return {
    orgId: data.org_id as string,
    email: (data.owner_email as string) ?? "api-key",
    userId: null,
    role: "admin",
    via: "api_key",
  };
}

/**
 * Authenticate a request by session cookie OR `Authorization: Bearer rb_live_…`.
 * Returns null if neither is present or valid — callers should 401.
 *
 * The Bearer header is checked first so an explicit credential always wins over
 * an ambient cookie; otherwise a signed-in developer testing a key in their
 * browser would silently get their own session's org instead of the key's.
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const raw = bearer(req);
  if (raw) return resolveKeyCaller(raw);

  const session = await getSession().catch(() => null);
  if (!session?.orgId) return null;

  return {
    orgId: session.orgId,
    email: session.email,
    userId: session.userId,
    role: session.role,
    via: "session",
  };
}

/**
 * Actor string to record in an audit trail. Keys are tagged so a governance
 * record can always distinguish automation from a human decision.
 */
export function actorLabel(caller: Caller): string {
  return caller.via === "api_key" ? `${caller.email} (api key)` : caller.email;
}
