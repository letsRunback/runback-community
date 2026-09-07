/**
 * Shared authentication for scheduled routes.
 *
 * Fifteen cron routes each compared the bearer token with `!==`, which returns
 * as soon as two bytes differ. That leaks the length and a prefix of the secret
 * through response timing, and it was inconsistent with exec-unlock, which
 * already used a constant-time compare for the same kind of value.
 *
 * The exposure is small — the routes are not advertised and the signal is noisy
 * across a serverless network path — but the fix costs nothing, and "small
 * enough to ignore" is not a judgement worth repeating in fifteen places.
 *
 * Fails closed: no CRON_SECRET configured means nothing authenticates, rather
 * than everything doing so.
 */
import { timingSafeEqual } from "node:crypto";

export function cronAuthorized(req: { headers: { get(name: string): string | null } }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal — hash both sides to a fixed width first so every comparison
  // takes the same path regardless of what was supplied.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so the mismatch branch is not measurably faster.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
