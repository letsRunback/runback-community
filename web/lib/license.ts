/**
 * Commercial license verification for self-hosted Runback.
 *
 * The Community edition is free forever (the core dev-tools). Enterprise features
 * — the fleet dashboard, team roles, SSO, alerting, long retention — are LOCKED
 * unless `RUNBACK_LICENSE` holds a license token that Runback signed.
 *
 * A license is `base64url(payload).base64url(ed25519-signature)`. The signature is
 * verified against the embedded public key, so a license can only be ISSUED by
 * whoever holds the private key (us) — setting RUNBACK_LICENSE=enterprise does
 * nothing. Verification is synchronous (Node Ed25519) so entitlement checks stay
 * synchronous everywhere.
 */
import crypto from "crypto";
import type { Plan } from "@/lib/entitlements";

// Safe to publish — verifies licenses, cannot sign them.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABdyHHg/R1JW9BSrBkEXNmsDJ7dgnLfa9CpBx43HexQE=
-----END PUBLIC KEY-----`;

export interface License {
  plan: Plan;          // "pro" | "enterprise"
  sub?: string;        // customer / org name
  exp?: number;        // unix seconds; absent = perpetual
}

const b64urlToBuf = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

interface CacheEntry { token: string; result: License | null; cachedAt: number }
let _cache: CacheEntry | null = null;
// Re-verify after 5 minutes so a revoked/expired license takes effect without
// requiring a process restart. Without a TTL, `verifyLicense("old")` returns a
// cached valid result even after the license expires mid-deployment.
const CACHE_TTL_MS = 5 * 60_000;

/** Verify a license token. Returns the licensed plan info, or null if invalid/expired. */
export function verifyLicense(token: string | null | undefined): License | null {
  if (!token) return null;
  const now = Date.now();
  if (_cache && _cache.token === token) {
    // Return cached result only if still fresh AND the license itself hasn't expired.
    const fresh = now - _cache.cachedAt < CACHE_TTL_MS;
    const licenseStillValid = !_cache.result?.exp || _cache.result.exp * 1000 > now;
    if (fresh && licenseStillValid) return _cache.result;
  }
  const result = verifyUncached(token.trim());
  _cache = { token, result, cachedAt: now };
  return result;
}

function verifyUncached(token: string): License | null {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;
    const payloadBytes = b64urlToBuf(payloadB64);
    const ok = crypto.verify(null, payloadBytes, PUBLIC_KEY_PEM, b64urlToBuf(sigB64));
    if (!ok) return null;
    const payload = JSON.parse(payloadBytes.toString("utf8")) as License & { iss?: string };
    if (payload.iss !== "runback") return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    if (payload.plan !== "pro" && payload.plan !== "enterprise") return null;
    return { plan: payload.plan, sub: payload.sub, exp: payload.exp };
  } catch {
    return null;
  }
}
