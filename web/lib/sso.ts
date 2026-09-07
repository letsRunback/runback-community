/**
 * Enterprise SSO via OIDC (Authorization Code flow). Each org configures its IdP
 * (issuer + client id/secret) and the email domains that route to it. Covers
 * Okta, Azure AD / Entra, Google Workspace, Auth0, Ping — anything OIDC.
 *
 * ID tokens are verified against the IdP's JWKS (jose), with issuer/audience/
 * nonce checks. No SAML (XML) — OIDC covers the modern enterprise IdPs.
 */
import crypto from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, type AuditActor } from "@/lib/adminAudit";
import type { Role } from "@/lib/auth";
import { isPrivateHostname, safeFetch } from "@/lib/ssrfGuard";
import { allowsPrivateTargets } from "@/lib/deployment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

// ── SSO client-secret encryption (AES-256-GCM) ──────────────────────────────
// Stored format: "enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>"
// Legacy plaintext values (no prefix) pass through decryptSsoSecret unchanged;
// they are re-encrypted on the next saveSsoConfig() call.
const ENC_PREFIX = "enc:v1:";

function ssoSecretKey(): Buffer {
  const raw = process.env.SSO_SECRET_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error(
        "SSO_SECRET_KEY must be set in production to encrypt SSO client secrets. " +
        "Generate one with: openssl rand -hex 32"
      );
    }
    // Dev-only: warn and return a zero key so SSO config pages still load.
    console.warn("[sso] SSO_SECRET_KEY not set — client secrets stored in plaintext (dev mode only)");
    return Buffer.alloc(32, 0);
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSsoSecret(plaintext: string): string {
  if (!process.env.SSO_SECRET_KEY) return plaintext; // dev fallback
  const key = ssoSecretKey();
  const iv = crypto.randomBytes(12); // 96-bit IV — GCM standard
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSsoSecret(stored: string): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored; // plaintext passthrough (legacy / dev)
  const key = ssoSecretKey();
  const parts = stored.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed SSO secret ciphertext.");
  const [ivHex, tagHex, ctHex] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return (
    decipher.update(Buffer.from(ctHex, "hex")).toString("utf8") +
    decipher.final("utf8")
  );
}
// ────────────────────────────────────────────────────────────────────────────

export interface SsoOrg {
  id: string;
  name: string;
  sso_issuer: string;
  sso_client_id: string;
  sso_client_secret: string;
  sso_default_role: Role;
  /** Email domains allowed to join this org via SSO. The verified token's email
   *  domain MUST be one of these — the org's IdP may authenticate broader (guests,
   *  B2B), but only these domains may provision into the org. */
  sso_domains: string[];
}

/** Find the SSO-enabled org that owns an email's domain, or null. */
export async function ssoOrgForEmail(email: string): Promise<SsoOrg | null> {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  const { data } = await db()
    .from("orgs")
    .select("id, name, sso_enabled, sso_issuer, sso_client_id, sso_client_secret, sso_default_role, sso_domains")
    .eq("sso_enabled", true)
    .contains("sso_domains", [domain])
    .maybeSingle();
  if (!data || !data.sso_issuer || !data.sso_client_id) return null;
  if (data.sso_client_secret) data.sso_client_secret = decryptSsoSecret(data.sso_client_secret);
  return data as SsoOrg;
}

export async function ssoOrgById(orgId: string): Promise<SsoOrg | null> {
  const { data } = await db()
    .from("orgs")
    .select("id, name, sso_enabled, sso_issuer, sso_client_id, sso_client_secret, sso_default_role, sso_domains")
    .eq("id", orgId)
    .eq("sso_enabled", true)
    .maybeSingle();
  if (!data || !data.sso_issuer) return null;
  if (data.sso_client_secret) data.sso_client_secret = decryptSsoSecret(data.sso_client_secret);
  return { ...data, sso_domains: data.sso_domains ?? [] } as SsoOrg;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}
const discoCache = new Map<string, { d: Discovery; expiresAt: number }>();
const DISCO_TTL_MS = 5 * 60 * 1000; // 5 minutes
export function assertSafeIssuer(issuer: string): void {
  let u: URL;
  try { u = new URL(issuer); } catch { throw new Error("Issuer must be a valid URL."); }
  if (u.protocol !== "https:") throw new Error("Issuer must use HTTPS.");
  // Blocked on hosted (SSRF); permitted on a self-host that opts in, where an
  // internal Keycloak or ADFS on 10.x is the normal case rather than an attack.
  if (isPrivateHostname(u.hostname) && !allowsPrivateTargets()) {
    throw new Error(
      "Issuer hostname is not a public address. Self-hosted deployments with an " +
      "internal identity provider can set RUNBACK_ALLOW_PRIVATE_TARGETS=true."
    );
  }
}

async function discover(issuer: string): Promise<Discovery> {
  const base = issuer.replace(/\/$/, "");
  const cached = discoCache.get(base);
  if (cached && cached.expiresAt > Date.now()) return cached.d;
  assertSafeIssuer(base);
  const res = await safeFetch(`${base}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed for ${base}`);
  const d = (await res.json()) as Discovery;
  // Validate URLs returned by the IdP — prevent SSRF via a malicious discovery doc
  assertSafeIssuer(d.jwks_uri);
  assertSafeIssuer(d.authorization_endpoint);
  assertSafeIssuer(d.token_endpoint);
  discoCache.set(base, { d, expiresAt: Date.now() + DISCO_TTL_MS });
  return d;
}

/** Build the IdP authorize URL to redirect the user to. */
export async function authorizeUrl(org: SsoOrg, redirectUri: string, state: string, nonce: string): Promise<string> {
  const d = await discover(org.sso_issuer);
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", org.sso_client_id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  return u.toString();
}

/** Exchange the code, verify the ID token, return the verified email. */
export async function verifyCallback(
  org: SsoOrg,
  code: string,
  redirectUri: string,
  nonce: string
): Promise<{ email: string; name?: string } | null> {
  const d = await discover(org.sso_issuer);
  // 1. code → tokens
  const tokRes = await safeFetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: org.sso_client_id,
      client_secret: org.sso_client_secret,
    }),
  });
  if (!tokRes.ok) {
    console.error("[sso] token exchange failed:", await tokRes.text().catch(() => ""));
    return null;
  }
  const tokens = (await tokRes.json()) as { id_token?: string };
  if (!tokens.id_token) return null;

  // 2. verify the ID token against the IdP JWKS
  try {
    const JWKS = createRemoteJWKSet(new URL(d.jwks_uri));
    const { payload } = await jwtVerify(tokens.id_token, JWKS, {
      issuer: d.issuer,
      audience: org.sso_client_id,
    });
    // Strict nonce: we always send one, so a compliant IdP must echo it. Require an
    // exact match (a token with no nonce, or a different one, is rejected — replay-safe).
    if ((payload.nonce ?? "") !== nonce) {
      console.error("[sso] nonce mismatch");
      return null;
    }
    const email = (payload.email as string) || "";
    if (!email) return null;
    return { email: email.toLowerCase(), name: (payload.name as string) || undefined };
  } catch (e) {
    console.error("[sso] id_token verify failed:", e);
    return null;
  }
}

/** Save SSO config for an org (admin action). */
export async function saveSsoConfig(orgId: string, cfg: {
  enabled: boolean; issuer: string; clientId: string; clientSecret?: string; domains: string[]; defaultRole: Role;
}, actor?: AuditActor): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: any = {
    sso_enabled: cfg.enabled,
    sso_issuer: cfg.issuer.trim() || null,
    sso_client_id: cfg.clientId.trim() || null,
    sso_domains: cfg.domains.map((x) => x.trim().toLowerCase()).filter(Boolean),
    sso_default_role: cfg.defaultRole,
  };
  if (cfg.clientSecret) patch.sso_client_secret = encryptSsoSecret(cfg.clientSecret.trim()); // only overwrite when provided
  const { error } = await db().from("orgs").update(patch).eq("id", orgId);
  if (error) throw new Error(`Could not save the SSO configuration: ${error.message}`);
  // Who can sign in, and from which domains, is the highest-signal setting in
  // the product. Records the issuer, domains and whether the secret rotated —
  // never the secret itself.
  await logAdminAction({
    orgId,
    action: cfg.enabled ? "sso.configure" : "sso.disable",
    targetType: "org", targetId: orgId,
    metadata: {
      issuer: patch.sso_issuer,
      domains: patch.sso_domains,
      default_role: cfg.defaultRole,
      secret_rotated: !!cfg.clientSecret,
    },
    actor,
  });
}

export async function getSsoConfig(orgId: string): Promise<{ enabled: boolean; issuer: string; clientId: string; hasSecret: boolean; domains: string[]; defaultRole: Role } | null> {
  const { data } = await db()
    .from("orgs")
    .select("sso_enabled, sso_issuer, sso_client_id, sso_client_secret, sso_domains, sso_default_role")
    .eq("id", orgId)
    .maybeSingle();
  if (!data) return null;
  return {
    enabled: !!data.sso_enabled,
    issuer: data.sso_issuer || "",
    clientId: data.sso_client_id || "",
    hasSecret: !!data.sso_client_secret && data.sso_client_secret.length > 0,
    domains: data.sso_domains || [],
    defaultRole: data.sso_default_role || "member",
  };
}
