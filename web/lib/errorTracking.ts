/**
 * Production error tracking.
 *
 * Before this, a server error went to console.error and nowhere else, so the
 * only way to learn Runback was broken was for a customer to say so. That is
 * an unacceptable answer for a platform sold as a system of record.
 *
 * Deliberately not Sentry: a third-party collector adds a subprocessor to the
 * DPA, moves customer identifiers and request context outside the deployment,
 * and does nothing for self-hosters, who operate their own instance and need
 * this most. Errors live in the same database as everything else and can be
 * forwarded to the customer's own SIEM through the sink that already exists.
 */
import { getAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export type Severity = "warning" | "error" | "fatal";

export interface ErrorContext {
  orgId?: string | null;
  route?: string | null;
  method?: string | null;
  severity?: Severity;
}

/**
 * Collapse the variable parts of a message so the same fault groups together.
 *
 * Get this wrong in one direction and every request produces a "new" error —
 * a firehose nobody reads. Wrong in the other and unrelated faults merge, so a
 * real outage hides inside an existing group that already looks known.
 *
 * Ids, numbers, quoted values and timestamps are the parts that vary per
 * request; the sentence around them is the fault.
 */
export function normaliseMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, "<ulid>")          // run ids
    .replace(/\b(?:rb_(?:live|test|comp|scim)_)[A-Za-z0-9]+/g, "<key>")
    .replace(/\b[0-9a-f]{32,}\b/gi, "<hash>")
    .replace(/"[^"]*"|'[^']*'/g, "<value>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/**
 * Strip anything that must not be persisted.
 *
 * An error message routinely carries whatever was being processed — including
 * a bearer token in a failed fetch, or a connection string. Storing errors is
 * only safe if storing them cannot become the leak.
 */
export function scrub(text: string): string {
  return text
    .replace(/\b(?:rb_(?:live|test|comp|scim)_)[A-Za-z0-9]+/g, "rb_<redacted>")
    .replace(/\b(?:sk|pk|gsk|xoxb)[-_][A-Za-z0-9-_]{8,}/g, "<redacted-key>")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<redacted-jwt>")
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1<redacted>@")
    // Redacts the WHOLE value, not just its first token. The earlier form
    // stopped at the first space, so `authorization: "Bearer abc123"` kept the
    // credential and dropped only the word "Bearer" — scrubbing that looks
    // like it worked is worse than none, because nobody looks again.
    .replace(
      /(authorization|api[-_]?key|password|secret|token)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\n,}]+)/gi,
      "$1$2<redacted>"
    );
}

/**
 * Stable identity: route + error type + the shape of the message.
 *
 * FNV-1a rather than SHA-256, and not for speed. This module is reached from
 * instrumentation.ts, which Next compiles for the Edge runtime as well as Node,
 * and importing node:crypto there fails — so error capture would have silently
 * stopped working for exactly the middleware faults you most want to see.
 *
 * A fingerprint is a grouping key, not a security primitive: nothing is
 * authenticated by it and collisions merge two faults into one group rather
 * than admitting anything. Where hashes DO carry weight — the run ledger, the
 * admin audit chain — SHA-256 is used and stays server-only.
 */
export function fingerprintOf(name: string, message: string, route?: string | null): string {
  const input = `${route ?? "-"}|${name}|${normaliseMessage(message)}`;
  // Two independent FNV-1a passes, concatenated — 64 bits of key space, which
  // is ample for grouping faults within one deployment.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export interface CaptureResult {
  recorded: boolean;
  isNew: boolean;
  occurrences: number;
  fingerprint: string;
}

/**
 * Record an error. Never throws.
 *
 * A failure here must not become a second error — that is how error handlers
 * turn an incident into a loop. It is not silent either: a tracker that quietly
 * stops recording is indistinguishable from a healthy system, which is the
 * exact illusion this exists to remove.
 */
export async function captureError(err: unknown, ctx: ErrorContext = {}): Promise<CaptureResult> {
  const fallback: CaptureResult = { recorded: false, isNew: false, occurrences: 0, fingerprint: "" };
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const name = e.name || "Error";
    const message = scrub(e.message || "(no message)").slice(0, 2000);
    // Query strings carry ids and tokens; the path is what identifies the fault.
    const route = ctx.route ? ctx.route.split("?")[0].slice(0, 200) : null;
    const stack = e.stack ? scrub(e.stack).slice(0, 8000) : null;
    const fingerprint = fingerprintOf(name, e.message || "", route);

    const { data, error } = await db().rpc("record_error", {
      p_fingerprint: fingerprint,
      p_org: ctx.orgId ?? null,
      p_name: name,
      p_message: message,
      p_stack: stack,
      p_route: route,
      p_method: ctx.method ?? null,
      p_severity: ctx.severity ?? "error",
    });
    if (error) {
      console.error("[errors] could not record an error:", error.message);
      return { ...fallback, fingerprint };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      recorded: true,
      isNew: !!row?.is_new,
      occurrences: Number(row?.occurrences ?? 1),
      fingerprint,
    };
  } catch (e) {
    console.error("[errors] error tracking itself failed:", e);
    return fallback;
  }
}

export interface ErrorGroup {
  id: string;
  fingerprint: string;
  name: string;
  message: string;
  route: string | null;
  method: string | null;
  severity: Severity;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
}

/** Open error groups, most recently seen first. */
export async function listErrors(opts: { limit?: number; includeResolved?: boolean } = {}): Promise<ErrorGroup[]> {
  let q = db()
    .from("ad_error_events")
    .select("id,fingerprint,name,message,route,method,severity,occurrences,first_seen,last_seen,resolved_at")
    .order("last_seen", { ascending: false })
    .limit(Math.min(opts.limit ?? 100, 500));
  if (!opts.includeResolved) q = q.is("resolved_at", null);
  const { data, error } = await q;
  if (error) throw new Error(`could not read errors: ${error.message}`);
  return (data ?? []) as ErrorGroup[];
}

/** Groups that have never been alerted on — the ones worth waking someone for. */
export async function unnotifiedErrors(limit = 20): Promise<ErrorGroup[]> {
  const { data, error } = await db()
    .from("ad_error_events")
    .select("id,fingerprint,name,message,route,method,severity,occurrences,first_seen,last_seen,resolved_at")
    .is("resolved_at", null)
    .is("notified_at", null)
    .order("last_seen", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`could not read new errors: ${error.message}`);
  return (data ?? []) as ErrorGroup[];
}

export async function markNotified(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db()
    .from("ad_error_events").update({ notified_at: new Date().toISOString() }).in("id", ids);
  if (error) console.error("[errors] could not mark notified:", error.message);
}
