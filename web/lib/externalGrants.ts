/**
 * External auditor/regulator read-only grants — issuance, listing, revocation,
 * and resolution of `external_grant`-scoped api_keys. See
 * sql/create_external_grants.sql for the ADR (why a third api_keys scope +
 * paired table, not a JWT or a trust.ts extension).
 *
 * Deliberately its own module, not folded into apiKeys.ts: apiKeys.ts hosts
 * simple issue/resolve pairs for scopes with no independent state
 * (compliance_read, scim). A grant has a lifecycle beyond the key itself —
 * label, scope, expiry, revocation, listing — that those don't need.
 */
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { getTenantClient } from "@/lib/supabase/tenant";

export type GrantScopeType = "run_ids" | "control_ids" | "org_wide";

export interface ExternalGrantRow {
  id: string;
  org_id: string;
  api_key_id: string;
  label: string;
  scope_type: GrantScopeType;
  run_ids: string[] | null;
  control_ids: string[] | null;
  issued_by: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readDb = (orgId: string) => getTenantClient(orgId).client as any;

export interface IssueExternalGrantInput {
  orgId: string;
  issuedBy: string; // the admin's email
  label: string;
  scopeType: GrantScopeType;
  runIds?: string[];
  controlIds?: string[];
  expiresAt: string; // ISO 8601 — mandatory, no open-ended external credential
}

/**
 * Issue a new external_grant key + its paired scope row. The raw key is
 * returned once and never stored — only its SHA-256 hash, same convention as
 * every other api_keys scope in this codebase.
 */
export async function issueExternalGrant(input: IssueExternalGrantInput): Promise<{ apiKey: string; grant: ExternalGrantRow } | null> {
  const raw = "rb_grant_" + crypto.randomBytes(24).toString("hex");
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  const keyPrefix = raw.slice(0, 16);

  const sb = db();
  const { data: keyRow, error: keyErr } = await sb
    .from("api_keys")
    .insert({
      key_prefix: keyPrefix,
      key_hash: keyHash,
      owner_email: input.issuedBy,
      plan: "free",
      org_id: input.orgId,
      scope: "external_grant",
      expires_at: input.expiresAt,
    })
    .select("id")
    .single();
  if (keyErr || !keyRow?.id) {
    console.error("[externalGrants] api_key issue failed:", keyErr?.message);
    return null;
  }

  const { data: grant, error: grantErr } = await sb
    .from("ad_external_grants")
    .insert({
      org_id: input.orgId,
      api_key_id: keyRow.id,
      label: input.label,
      scope_type: input.scopeType,
      run_ids: input.scopeType === "run_ids" ? (input.runIds ?? []) : null,
      control_ids: input.scopeType === "control_ids" ? (input.controlIds ?? []) : null,
      issued_by: input.issuedBy,
      expires_at: input.expiresAt,
    })
    .select()
    .single();
  if (grantErr || !grant) {
    // Roll back the orphaned key — a grant row that failed to write must not
    // leave a live, unlisted, unrevocable credential behind.
    console.error("[externalGrants] grant issue failed:", grantErr?.message);
    await sb.from("api_keys").delete().eq("id", keyRow.id);
    return null;
  }

  const { logAdminAction } = await import("@/lib/adminAudit");
  await logAdminAction({
    orgId: input.orgId,
    action: "api_key.create",
    targetType: "external_grant",
    targetId: keyPrefix,
    actor: { email: input.issuedBy, kind: "user" },
    metadata: { scope: "external_grant", scope_type: input.scopeType, label: input.label, expires_at: input.expiresAt },
  });

  return { apiKey: raw, grant: grant as ExternalGrantRow };
}

/** List an org's external grants — never returns the raw key, only issuance metadata. */
export async function listExternalGrants(orgId: string): Promise<ExternalGrantRow[]> {
  const { data, error } = await readDb(orgId)
    .from("ad_external_grants")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[externalGrants] list failed: ${error.message}`);
  return (data ?? []) as ExternalGrantRow[];
}

/** Revoke a grant: marks both the grant row and its underlying api_key inactive — either check alone is sufficient going forward, but both are set so a stale read of either table still fails closed. */
export async function revokeExternalGrant(orgId: string, grantId: string, revokedBy: string): Promise<boolean> {
  const sb = db();
  const { data: grant } = await sb
    .from("ad_external_grants")
    .select("id, api_key_id, org_id")
    .eq("id", grantId)
    .eq("org_id", orgId)
    .is("revoked_at", null) // already-revoked is a 404, not a silent re-ok — the row still exists, so without this the second DELETE looked like it worked
    .maybeSingle();
  if (!grant) return false;

  const now = new Date().toISOString();
  const { error: grantErr } = await sb.from("ad_external_grants").update({ revoked_at: now }).eq("id", grantId);
  const { error: keyErr } = await sb.from("api_keys").update({ active: false }).eq("id", grant.api_key_id);
  if (grantErr || keyErr) {
    console.error("[externalGrants] revoke failed:", grantErr?.message, keyErr?.message);
    return false;
  }

  const { logAdminAction } = await import("@/lib/adminAudit");
  await logAdminAction({
    orgId,
    action: "api_key.revoke",
    targetType: "external_grant",
    targetId: grantId,
    actor: { email: revokedBy, kind: "user" },
    metadata: { scope: "external_grant" },
  });
  return true;
}

/**
 * Resolve an external_grant key against ONE requested run — the "rejects
 * everything outside its one purpose" shape resolveComplianceKey established,
 * generalized for a dynamic scope. Returns the grant's org only if the key is
 * active, unexpired, unrevoked, AND its scope actually covers `runId`:
 *   - 'org_wide'   → any run in the org
 *   - 'run_ids'    → runId must be in the grant's run_ids list
 *   - 'control_ids' → never covers a run (that scope is for compliance
 *     narratives, resolved separately) — always rejected here
 */
export async function resolveExternalGrantForRun(rawKey: string | null, runId: string): Promise<{ orgId: string } | null> {
  if (!rawKey) return null;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const sb = db();
  const { data: keyRow } = await sb
    .from("api_keys")
    .select("id, org_id, expires_at, scope, active")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .eq("scope", "external_grant")
    .maybeSingle();
  if (!keyRow?.org_id) return null;
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) return null;

  const { data: grant } = await sb
    .from("ad_external_grants")
    .select("scope_type, run_ids, expires_at, revoked_at")
    .eq("api_key_id", keyRow.id)
    .maybeSingle();
  if (!grant) return null;
  if (!grantCoversRun(grant, runId)) return null;
  return { orgId: keyRow.org_id as string };
}

/**
 * Pure scope-matching decision — exported for unit testing without a
 * database, mirroring corpusMiner.ts's split of pure logic from the
 * DB-heavy caller elsewhere in this codebase. Revocation and expiry are
 * checked here too (not just scope) so there is exactly one place that
 * decides "does this grant currently authorize reading this run" —
 * splitting that check across two functions is how a future edit misses one.
 */
export function grantCoversRun(
  grant: { scope_type: GrantScopeType; run_ids: string[] | null; expires_at: string; revoked_at: string | null },
  runId: string,
  now: Date = new Date()
): boolean {
  if (grant.revoked_at) return false;
  if (new Date(grant.expires_at) < now) return false;
  if (grant.scope_type === "org_wide") return true;
  if (grant.scope_type === "run_ids") return Array.isArray(grant.run_ids) && grant.run_ids.includes(runId);
  return false; // 'control_ids' never covers a run — that scope is for compliance narratives, resolved separately
}
