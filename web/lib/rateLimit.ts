/**
 * Cost/abuse guardrail for endpoints that spend money (model calls) or gate auth.
 *
 * Prefers a SHARED Postgres store (the `rate_limit_hit` RPC) so the limit is global
 * across serverless instances — an attacker can't spread requests over warm
 * functions to bypass a per-instance counter. If the RPC is unavailable (migration
 * not applied yet, DB hiccup, or self-host without it) it transparently falls back
 * to the per-instance in-memory limiter, so it always degrades safe, never throws.
 */
import { getAdminClient } from "@/lib/supabase/admin";

export interface RateResult {
  ok: boolean;
  retryAfter: number;
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Per-instance fallback limiter (a real backstop; not cross-instance). */
function rateLimitMemory(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { ok: true, retryAfter: 0 };
}

// Dedup Postgres-unavailable alerts: emit at most once per 5 minutes.
let _pgAlertedAt = 0;
const PG_ALERT_COOLDOWN_MS = 5 * 60_000;

function emitRateLimitDegradedAlert(key: string, err: unknown): void {
  const now = Date.now();
  if (now - _pgAlertedAt < PG_ALERT_COOLDOWN_MS) return;
  _pgAlertedAt = now;
  // Structured log — any log-aggregation pipeline can alert on this event name.
  console.error(JSON.stringify({
    level: "ERROR",
    event: "rate_limit_pg_degraded",
    message: "Shared Postgres rate-limiter unavailable — falling back to per-instance limiter. Distributed rate-limit bypass possible.",
    triggering_key: key,
    error: String(err),
  }));
  // Best-effort Slack alert if an ops webhook is configured.
  const slack = process.env.SLACK_WEBHOOK_URL;
  if (slack) {
    fetch(slack, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "⚠️ *Runback rate-limiter degraded*: Postgres RPC unavailable, falling back to per-instance in-memory limiter. Distributed rate-limit bypass is possible until the DB recovers.",
      }),
    }).catch(() => {}); // best-effort
  }
}

/**
 * Shared implementation. `failClosed` used to be decided by matching the key
 * against a separate prefix allowlist (FAIL_CLOSED_PREFIXES) kept in this
 * file — which is exactly what caused a real incident: the list read
 * "auth-magic-ip:" while the route actually passed "magic-ip:", so the
 * startsWith() silently never matched and the one auth endpoint that sends
 * outbound email fell back to the per-instance limiter precisely when the
 * shared limiter was degraded (bypassable by fanning requests across warm
 * serverless instances). That failure mode — a safety property living in a
 * file the developer adding a new endpoint has no reason to open — is
 * structural, not a one-off typo, so rateLimit()/rateLimitFailClosed() below
 * are now two distinctly-named exports instead of one function plus a hidden
 * allowlist: the choice is made at the call site the developer is already
 * writing, not in a separate file fifty lines away they'd have to remember
 * exists.
 */
async function rateLimitCore(key: string, limit: number, windowMs: number, failClosed: boolean): Promise<RateResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { data, error } = await sb.rpc("rate_limit_hit", {
      p_key: key,
      p_max: limit,
      p_window_ms: windowMs,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && typeof row.allowed === "boolean") {
      return { ok: row.allowed, retryAfter: Number(row.retry_after) || 0 };
    }
  } catch (err) {
    emitRateLimitDegradedAlert(key, err);
    if (failClosed) {
      // Deny rather than fall back to a per-instance counter an attacker can
      // bypass by fanning requests across warm instances.
      return { ok: false, retryAfter: 60 };
    }
  }
  return rateLimitMemory(key, limit, windowMs);
}

/**
 * Standard rate limit: degrades to a per-instance limiter if the shared
 * Postgres store is unavailable, rather than denying every request. Use this
 * unless the endpoint gates authentication or spends money/reputation on an
 * outbound side effect (email, SMS) — for those, use rateLimitFailClosed.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  return rateLimitCore(key, limit, windowMs, false);
}

/**
 * Fail-CLOSED rate limit: denies outright, rather than degrading, if the
 * shared store is unavailable. Reserved for endpoints where a distributed
 * bypass is high-impact — password/token brute force, outbound email
 * bombing. __tests__/rateLimitFailClosed.test.ts pins which routes must call
 * this instead of rateLimit().
 */
export async function rateLimitFailClosed(key: string, limit: number, windowMs: number): Promise<RateResult> {
  return rateLimitCore(key, limit, windowMs, true);
}

/** Best-effort client IP from Vercel's forwarding headers.
 *
 * On Vercel (managed cloud): x-vercel-forwarded-for is platform-set and not
 * spoofable by the client — it is the canonical source IP.
 *
 * On self-hosted deployments: x-forwarded-for is client-controlled unless the
 * operator's reverse proxy (Caddy, nginx) explicitly strips incoming values and
 * appends the real client IP. Operators MUST configure their proxy to set
 * X-Real-IP or strip incoming X-Forwarded-For before routing to the app.
 * Without this, IP-based rate limits can be bypassed by spoofing XFF headers.
 */
export function clientIp(req: Request): string {
  // Prefer Vercel's own header (platform-set, not overridable by client).
  const vercelIp = req.headers.get("x-vercel-forwarded-for");
  if (vercelIp) return vercelIp.split(",")[0].trim();
  // x-real-ip is typically set by nginx/Caddy from the TCP source IP.
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  // Last resort: rightmost XFF entry. Spoofable if proxy does not strip XFF.
  const xff = req.headers.get("x-forwarded-for") || "";
  if (xff) return xff.split(",").at(-1)!.trim();
  return "unknown";
}
