/**
 * Bring-your-own model keys for managed cloud. A customer's provider key is stored
 * AES-256-GCM encrypted (under MODEL_KEY_SECRET) and is never returned to the
 * browser — only the last 4 chars. Server-side replay/counterfactual/golden runs
 * read the decrypted key; absent, they fall back to the deployment env var.
 * Self-host can ignore this and just set OPENAI_API_KEY etc. in env.
 */
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, type AuditActor } from "@/lib/adminAudit";

export type Provider = "openai" | "anthropic" | "groq";
export const PROVIDERS: Provider[] = ["openai", "anthropic", "groq"];

function secretKey(): Buffer {
  const s = process.env.MODEL_KEY_SECRET;
  if (!s) {
    // Key separation: MODEL_KEY_SECRET must be distinct from AUDIT_SIGNING_KEY.
    // Rotating the audit signing key must not simultaneously invalidate all stored BYOK keys.
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error("MODEL_KEY_SECRET must be set to store model keys in production. Set it independently of AUDIT_SIGNING_KEY.");
    }
    if (process.env.AUDIT_SIGNING_KEY) {
      console.warn("[modelKeys] MODEL_KEY_SECRET not set — NOT falling back to AUDIT_SIGNING_KEY. Using DEV-ONLY key. Set MODEL_KEY_SECRET separately for real encryption.");
    } else {
      console.warn("[modelKeys] no MODEL_KEY_SECRET set — using a DEV-ONLY key. Set MODEL_KEY_SECRET for real encryption.");
    }
    return crypto.createHash("sha256").update("runback-dev-model-key-secret").digest();
  }
  return crypto.createHash("sha256").update(s).digest();
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob: string): string | null {
  try {
    const [iv, tag, ct] = blob.split(".").map((s) => Buffer.from(s, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function setOrgKey(orgId: string, provider: Provider, key: string, actor?: AuditActor): Promise<void> {
  const k = key.trim();
  if (!PROVIDERS.includes(provider) || k.length < 8) throw new Error("Invalid provider or key.");
  const sb = getAdminClient() as any;
  const { error } = await sb.from("ad_model_keys").upsert(
    { org_id: orgId, provider, key_cipher: encrypt(k), key_last4: k.slice(-4), updated_at: new Date().toISOString() },
    { onConflict: "org_id,provider" }
  );
  if (error) throw new Error(`Could not store the ${provider} key: ${error.message}`);
  // last4 only — the audit log must never become a place secrets leak to.
  await logAdminAction({ orgId, action: "model_key.set", targetType: "provider", targetId: provider,
    metadata: { last4: k.slice(-4) }, actor,
  });
}

export async function deleteOrgKey(orgId: string, provider: Provider, actor?: AuditActor): Promise<void> {
  const sb = getAdminClient() as any;
  const { error } = await sb.from("ad_model_keys").delete().eq("org_id", orgId).eq("provider", provider);
  if (error) throw new Error(`Could not delete the ${provider} key: ${error.message}`);
  await logAdminAction({ orgId, action: "model_key.delete", targetType: "provider", targetId: provider,
    actor,
  });
}

/** Masked list for the UI — never the full key. */
export async function listMaskedKeys(orgId: string): Promise<{ provider: string; last4: string; updated_at: string }[]> {
  try {
    const sb = getAdminClient() as any;
    const { data } = await sb.from("ad_model_keys").select("provider,key_last4,updated_at").eq("org_id", orgId);
    return (data ?? []).map((r: any) => ({ provider: r.provider, last4: r.key_last4, updated_at: r.updated_at }));
  } catch {
    return [];
  }
}

/** Decrypted keys for server-side model calls. Falls back to env when an org key is absent. */
export async function getOrgKeys(orgId: string | null): Promise<Partial<Record<Provider, string>>> {
  const out: Partial<Record<Provider, string>> = {};
  if (orgId) {
    try {
      const sb = getAdminClient() as any;
      const { data } = await sb.from("ad_model_keys").select("provider,key_cipher").eq("org_id", orgId);
      for (const r of data ?? []) {
        const k = decrypt(r.key_cipher);
        if (k && PROVIDERS.includes(r.provider)) out[r.provider as Provider] = k;
      }
    } catch { /* table may lag */ }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
