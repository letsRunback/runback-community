/**
 * Checked writes.
 *
 * Why this exists
 * ---------------
 * PostgREST does not throw. A write against a column or table that does not
 * exist comes back as `{ data: null, error: {...} }` — and 76 call sites in this
 * codebase awaited that result without ever looking at `error`. The failures
 * were therefore invisible, and each one surfaced as something misleading:
 *
 *   • `auth_tokens.link_id` missing  → issueMagicLink's insert failed, the route
 *     still returned `{ok:true}`, and every magic link led to "expired".
 *   • `api_keys.expires_at` missing  → resolveApiKey's SELECT errored, `data`
 *     came back undefined, and every valid key 401'd as "Invalid API key".
 *   • `ad_runs.parent_run_id` missing → the topology query errored, `data` was
 *     null, and the UI rendered "No orchestrations yet".
 *   • `users.plg_email_unsubscribed` missing → the unsubscribe UPDATE no-opped,
 *     the user was redirected to a success page, and the mail kept sending.
 *
 * None of those looked like a bug from the outside. That is the point: a failed
 * write must never be able to report success.
 *
 * Usage
 * -----
 *   await mustWrite(sb.from("sessions").insert({ ... }), "create session");
 *
 *   // Where a failure genuinely is tolerable (best-effort telemetry, a
 *   // migration-lag fallback with a real retry), say so explicitly:
 *   await tryWrite(sb.from("api_keys").update({ last_used_at }), "stamp key use");
 *
 * `tryWrite` still logs. The rule is not "never tolerate a failure" — it is
 * "never tolerate one silently".
 */

/** The shape every supabase-js query builder resolves to. */
interface PostgrestResultLike {
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

export class DbWriteError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
    message: string
  ) {
    super(`${operation} failed: ${message}${code ? ` (${code})` : ""}`);
    this.name = "DbWriteError";
  }
}

/**
 * Await a write and THROW if the database rejected it.
 *
 * Use for any write whose failure would make a user-visible claim untrue —
 * creating a session, consuming a token, recording consent, sealing a ledger
 * entry. The caller's error path (or the route's 500) is a far better outcome
 * than a success response over a write that did not happen.
 */
export async function mustWrite<T extends PostgrestResultLike>(
  query: PromiseLike<T>,
  operation: string
): Promise<T> {
  const res = await query;
  if (res.error) {
    console.error(`[db] ${operation} failed:`, res.error.message, res.error.details ?? "");
    throw new DbWriteError(operation, res.error.code, res.error.message);
  }
  return res;
}

/**
 * Await a write, log loudly on failure, and carry on.
 *
 * Only for writes that are genuinely best-effort — a last-used timestamp, a
 * cache warm, an analytics breadcrumb. Returns whether it succeeded so a caller
 * can still branch. If you find yourself reaching for this to silence an error
 * you do not understand, use mustWrite instead and fix the cause.
 */
export async function tryWrite<T extends PostgrestResultLike>(
  query: PromiseLike<T>,
  operation: string
): Promise<boolean> {
  const res = await query;
  if (res.error) {
    console.error(`[db] ${operation} failed (non-fatal):`, res.error.message, res.error.details ?? "");
    return false;
  }
  return true;
}
