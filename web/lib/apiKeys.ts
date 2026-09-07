/**
 * Issue a hosted free-tier ingest key for a captured lead. The raw key is shown
 * once on screen; only its SHA-256 hash is stored (same scheme as
 * scripts/make-api-key.mjs and resolveApiKey in lib/ingest).
 */
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Key scopes, narrowest first.
 *
 * "trace_write" is the scope an SDK key embedded in a customer's application
 * should carry. It can POST traces and nothing else: getCaller() rejects it, so
 * it cannot reach the general API at all — no evals, no replay, no prompt
 * writes, no reading another surface. If it leaks from a repository or a
 * container image, the holder can send us telemetry. That is the whole blast
 * radius.
 *
 * "ingest" is the historical scope and is deliberately NOT changed. It resolves
 * to role "admin" in getCaller and drives the documented Bearer-token flows —
 * the CI release gate, step replay, whole-run re-execution. Silently narrowing
 * it would break those for every existing customer on their next deploy, which
 * is a worse outcome than the exposure it would close. Existing keys keep
 * working; new SDK keys should be issued trace_write.
 */
export type ApiKeyScope = "trace_write" | "ingest" | "compliance_read" | "security_findings" | "scim";

/** Scopes that may send run data to /api/ingest. */
export const INGEST_SCOPES: readonly ApiKeyScope[] = ["trace_write", "ingest"];

export async function issueApiKey(
  email: string,
  orgId?: string | null,
  // Defaults to the historical scope so existing callers and the documented CI
  // flows are unaffected. Pass "trace_write" for a key that only ever ships
  // telemetry.
  scope: Extract<ApiKeyScope, "ingest" | "trace_write"> = "ingest"
): Promise<string | null> {
  const raw = "rb_live_" + crypto.randomBytes(24).toString("hex");
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  const keyPrefix = raw.slice(0, 16);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    let { error } = await sb
      .from("api_keys")
      .insert({ key_prefix: keyPrefix, key_hash: keyHash, owner_email: email, plan: "free", org_id: orgId ?? null, scope });
    if (error) {
      // `scope` column may not exist yet (migration lag: sql/add_api_key_scope.sql
      // not yet run on this database) — retry without it so ingest-key issuance
      // never breaks on a deploy-before-migrate window. Existing keys default to
      // scope='ingest' at the column level once the migration does run.
      ({ error } = await sb
        .from("api_keys")
        .insert({ key_prefix: keyPrefix, key_hash: keyHash, owner_email: email, plan: "free", org_id: orgId ?? null }));
    }
    if (error) {
      console.error("[apiKeys] issue failed:", error.message || error);
      return null;
    }

    // /security and the SOC 2 CC4.1 row both state that key issuance is recorded
    // in the hash-chained admin log. It was not: the only api_key.create ever
    // written came from the SCIM token path, so the PRIMARY ingest key — the one
    // that grants write access to a tenant's trace data — was issued silently.
    // Logged here rather than in the route so every issuance path is covered.
    //
    // Never let an audit-log failure block issuance: logAdminAction swallows its
    // own errors, and the key already exists by this point.
    if (orgId) {
      const { logAdminAction } = await import("@/lib/adminAudit");
      await logAdminAction({
        orgId,
        action: "api_key.create",
        targetType: "api_key",
        targetId: keyPrefix,
        actor: { email, kind: "user" },
        metadata: { scope: "ingest" },
      });
    }
    return raw;
  } catch (e) {
    console.error("[apiKeys] issue threw:", e);
    return null;
  }
}

/**
 * Issue a `compliance_read` key — a deliberately narrow scope that resolves to
 * exactly one route (/api/v1/compliance/evidence-summary) and nothing else: no
 * ingest, no run content, no dashboard session. Meant to be handed to a
 * third-party integration (e.g. EAAPL) without granting it anything more than
 * aggregate regulatory-evidence numbers. Caller must check `orgHasFeature(orgId,
 * "regulatory")` before calling this — issuance is not itself entitlement-gated.
 */
export async function issueComplianceKey(email: string, orgId: string): Promise<string | null> {
  const raw = "rb_comp_" + crypto.randomBytes(24).toString("hex");
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  const keyPrefix = raw.slice(0, 16);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { error } = await sb
      .from("api_keys")
      .insert({ key_prefix: keyPrefix, key_hash: keyHash, owner_email: email, plan: "free", org_id: orgId, scope: "compliance_read" });
    if (error) {
      console.error("[apiKeys] compliance key issue failed:", error.message || error);
      return null;
    }
    return raw;
  } catch (e) {
    console.error("[apiKeys] compliance key issue threw:", e);
    return null;
  }
}

/**
 * Resolve a `compliance_read` key to its org id. Rejects ingest-scoped keys,
 * inactive keys, and expired keys — this is the ONLY thing a leaked
 * compliance-read credential can ever do, by construction.
 */
export async function resolveComplianceKey(rawKey: string | null): Promise<{ orgId: string } | null> {
  if (!rawKey) return null;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb
    .from("api_keys")
    .select("org_id, expires_at, scope")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .eq("scope", "compliance_read")
    .single();
  if (!data?.org_id) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { orgId: data.org_id as string };
}

/**
 * Issue a `security_findings` key — a deliberately narrow scope that can only
 * ever POST to /api/security-findings, nothing else: no ingest, no run
 * content, no dashboard access. Meant to be pasted into a guardrail vendor's
 * (Lakera, Cisco AI Defense, ...) outbound-webhook config so their findings
 * land in this org's own sealed audit trail without granting that vendor
 * integration anything more than "can write a finding".
 */
export async function issueSecurityFindingsKey(email: string, orgId: string): Promise<string | null> {
  const raw = "rb_secfind_" + crypto.randomBytes(24).toString("hex");
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  const keyPrefix = raw.slice(0, 16);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { error } = await sb
      .from("api_keys")
      .insert({ key_prefix: keyPrefix, key_hash: keyHash, owner_email: email, plan: "free", org_id: orgId, scope: "security_findings" });
    if (error) {
      console.error("[apiKeys] security-findings key issue failed:", error.message || error);
      return null;
    }
    return raw;
  } catch (e) {
    console.error("[apiKeys] security-findings key issue threw:", e);
    return null;
  }
}

/**
 * Resolve a `security_findings` key to its org id. Rejects ingest-scoped
 * keys, inactive keys, and expired keys — same shape as resolveComplianceKey.
 */
export async function resolveSecurityFindingsKey(rawKey: string | null): Promise<{ orgId: string } | null> {
  if (!rawKey) return null;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb
    .from("api_keys")
    .select("org_id, expires_at, scope")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .eq("scope", "security_findings")
    .maybeSingle();
  if (!data?.org_id) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { orgId: data.org_id as string };
}

/**
 * Issue a `scim` key — the bearer token an identity provider (Okta, Entra)
 * presents to /api/scim/v2. Deliberately its own scope: it can create and
 * deactivate members and nothing else. It cannot ingest runs, read run content,
 * or open a dashboard session, so a token pasted into an IdP config is not a
 * general-purpose credential.
 */
export async function issueScimKey(email: string, orgId: string): Promise<string | null> {
  const raw = "rb_scim_" + crypto.randomBytes(24).toString("hex");
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { error } = await sb.from("api_keys").insert({
      key_prefix: raw.slice(0, 16), key_hash: keyHash, owner_email: email,
      plan: "free", org_id: orgId, scope: "scim",
    });
    if (error) {
      console.error("[apiKeys] scim key issue failed:", error.message || error);
      return null;
    }
    return raw;
  } catch (e) {
    console.error("[apiKeys] scim key issue threw:", e);
    return null;
  }
}

/** Resolve a `scim` bearer token to its org. Rejects every other scope. */
export async function resolveScimKey(rawKey: string | null): Promise<{ orgId: string } | null> {
  if (!rawKey) return null;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb
    .from("api_keys")
    .select("org_id, expires_at, scope")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .eq("scope", "scim")
    .maybeSingle();
  if (!data?.org_id) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { orgId: data.org_id as string };
}
