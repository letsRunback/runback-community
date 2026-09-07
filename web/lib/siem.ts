/**
 * Forward the platform audit log to the customer's security monitoring system.
 *
 * Enterprises do not accept "sign in to our dashboard to see who did what".
 * Access-control evidence has to reach the SOC, where their detections,
 * correlation and retention obligations already apply. A governance product
 * that keeps its own audit trail inside its own UI is a silo.
 *
 * Delivery is at-least-once and resumes from a per-sink watermark. A duplicate
 * is harmless — every event carries a stable event_id the SIEM de-duplicates
 * on — whereas a gap in a security feed is exactly what an attacker wants.
 */
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import type { AdminEvent } from "@/lib/adminAudit";
import { isPrivateHostname, safeFetch } from "@/lib/ssrfGuard";
import { allowsPrivateTargets } from "@/lib/deployment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export type SinkKind = "splunk_hec" | "sentinel" | "webhook";

export interface SiemSink {
  id: string;
  org_id: string;
  kind: SinkKind;
  endpoint: string;
  enabled: boolean;
  cursor_seq: number;
  last_ok_at: string | null;
  last_error: string | null;
}

/* ── secret at rest ───────────────────────────────────────────────────────── */

/**
 * Its own key, deliberately. The codebase already separates AUDIT_SIGNING_KEY,
 * MODEL_KEY_SECRET and SSO_SECRET_KEY so rotating one never invalidates the
 * others; a collector token is another independent secret and gets the same
 * treatment. Falls back to MODEL_KEY_SECRET only so an existing self-host does
 * not break on upgrade — never to the audit signing key.
 */
function secretKey(): Buffer {
  const s = process.env.SIEM_SECRET_KEY || process.env.MODEL_KEY_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error("SIEM_SECRET_KEY must be set to store a SIEM collector token in production.");
    }
    console.warn("[siem] no SIEM_SECRET_KEY set — using a DEV-ONLY key.");
    return crypto.createHash("sha256").update("runback-dev-siem-secret").digest();
  }
  return crypto.createHash("sha256").update(s).digest();
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob: string | null): string | null {
  if (!blob) return null;
  try {
    const [iv, tag, ct] = blob.split(".").map((s) => Buffer.from(s, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* ── config ───────────────────────────────────────────────────────────────── */

/** Reject anything that is not HTTPS — audit events must not cross the wire in clear. */
export function assertSafeEndpoint(endpoint: string): void {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw new Error("The collector endpoint must be a valid URL.");
  }
  if (u.protocol !== "https:") {
    throw new Error("The collector endpoint must use HTTPS — audit events must not be sent in the clear.");
  }
  // A self-hosted Splunk is on the customer's own network; on the multi-tenant
  // service, pointing our egress at a private address is SSRF. See
  // lib/deployment.ts for why the answer differs by deployment.
  if (isPrivateHostname(u.hostname) && !allowsPrivateTargets()) {
    throw new Error(
      "The collector endpoint is not a public address. Self-hosted deployments with an " +
      "internal collector can set RUNBACK_ALLOW_PRIVATE_TARGETS=true."
    );
  }
}

export async function getSink(orgId: string): Promise<SiemSink | null> {
  const { data, error } = await db()
    .from("ad_siem_sinks")
    .select("id,org_id,kind,endpoint,enabled,cursor_seq,last_ok_at,last_error")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`could not read the SIEM configuration: ${error.message}`);
  return (data ?? null) as SiemSink | null;
}

export async function saveSink(
  orgId: string,
  cfg: { kind: SinkKind; endpoint: string; token?: string; enabled?: boolean }
): Promise<SiemSink> {
  assertSafeEndpoint(cfg.endpoint);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: any = {
    org_id: orgId,
    kind: cfg.kind,
    endpoint: cfg.endpoint.trim(),
    enabled: cfg.enabled ?? true,
    last_error: null,
  };
  // Only overwrite the token when one is supplied, so editing the endpoint does
  // not silently blank the credential.
  if (cfg.token) patch.token_cipher = encrypt(cfg.token.trim());

  const { data, error } = await db()
    .from("ad_siem_sinks")
    .upsert(patch, { onConflict: "org_id" })
    .select("id,org_id,kind,endpoint,enabled,cursor_seq,last_ok_at,last_error")
    .single();
  if (error || !data) throw new Error(`could not save the SIEM configuration: ${error?.message ?? "upsert returned no row"}`);
  return data as SiemSink;
}

export async function deleteSink(orgId: string): Promise<void> {
  const { error } = await db().from("ad_siem_sinks").delete().eq("org_id", orgId);
  if (error) throw new Error(`could not remove the SIEM configuration: ${error.message}`);
}

/* ── formatting ───────────────────────────────────────────────────────────── */

/** The neutral shape every sink derives from — one audit entry, flattened. */
export function toCommonEvent(orgId: string, e: AdminEvent) {
  return {
    event_id: e.event_id,
    seq: e.seq,
    org_id: orgId,
    timestamp: e.created_at,
    action: e.action,
    actor: { kind: e.actor_kind, email: e.actor_email, label: e.actor_label },
    target: { type: e.target_type, id: e.target_id },
    metadata: e.metadata,
    source_ip: e.ip,
    // Lets a SIEM prove the feed itself was not altered in transit or at rest.
    integrity: { leaf_hash: e.leaf_hash, entry_hash: e.entry_hash, prev_hash: e.prev_hash },
    product: "runback",
    log_type: "runback_admin_audit",
  };
}

/**
 * Render a batch in the sink's own wire format.
 *
 * Splunk HEC wants newline-delimited {event, time, sourcetype} objects — NOT a
 * JSON array, which it rejects. Sentinel and generic webhooks take a JSON array.
 */
export function renderBatch(kind: SinkKind, orgId: string, events: AdminEvent[]): string {
  const common = events.map((e) => toCommonEvent(orgId, e));
  if (kind === "splunk_hec") {
    return common
      .map((c) => JSON.stringify({
        time: Math.floor(new Date(c.timestamp).getTime() / 1000),
        sourcetype: "runback:admin_audit",
        source: "runback",
        event: c,
      }))
      .join("\n");
  }
  return JSON.stringify(common);
}

/**
 * Azure Entra client-credentials token for the Logs Ingestion API.
 *
 * Sentinel does not accept a static bearer token. It wants an Entra-issued
 * access token for the https://monitor.azure.com/.default scope, valid about an
 * hour. We were sending whatever string the customer pasted, forever — which
 * works for exactly as long as the token they pasted is valid, and then returns
 * 401 permanently. An export that stops after an hour and never resumes is
 * worse than one that never starts, because the failure is invisible until an
 * auditor asks where the last three months of events went.
 *
 * Credentials are supplied as "tenantId:clientId:clientSecret" in the token
 * field, so the existing encrypted-secret storage covers them with no schema
 * change.
 */
const entraCache = new Map<string, { token: string; expiresAt: number }>();

async function sentinelAccessToken(credential: string): Promise<string> {
  const parts = credential.split(":");
  if (parts.length < 3) {
    throw new Error(
      "Sentinel credentials must be `tenantId:clientId:clientSecret` — a raw bearer token " +
        "cannot be refreshed and stops working within the hour."
    );
  }
  const [tenantId, clientId, ...rest] = parts;
  const clientSecret = rest.join(":"); // secrets may contain ':'

  const cacheKey = `${tenantId}:${clientId}`;
  const hit = entraCache.get(cacheKey);
  // 60s of slack so a token cannot expire mid-flight.
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://monitor.azure.com/.default",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Entra token request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Entra returned no access_token.");

  entraCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

async function headersFor(kind: SinkKind, token: string | null): Promise<Record<string, string>> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (!token) return h;
  if (kind === "splunk_hec") h.authorization = `Splunk ${token}`;
  else if (kind === "sentinel") h.authorization = `Bearer ${await sentinelAccessToken(token)}`;
  else h.authorization = `Bearer ${token}`;
  return h;
}

/* ── delivery ─────────────────────────────────────────────────────────────── */

export interface ExportResult {
  orgId: string;
  delivered: number;
  cursor: number;
  error?: string;
}

/** How many entries to send per run. Bounded so one backlogged org cannot monopolise the cron. */
const BATCH = 500;

/**
 * Ship everything after the watermark for one org.
 *
 * The cursor only advances on a confirmed 2xx. A failure leaves it where it
 * was, so the next run re-sends: at-least-once, never at-most-once.
 */
export async function exportForOrg(sink: SiemSink): Promise<ExportResult> {
  const { data, error } = await db()
    .from("ad_admin_events")
    .select("seq,event_id,actor_kind,actor_email,actor_label,action,target_type,target_id,metadata,ip,created_at,entry_hash,prev_hash,leaf_hash")
    .eq("org_id", sink.org_id)
    .gt("seq", sink.cursor_seq)
    .order("seq", { ascending: true })
    .limit(BATCH);
  if (error) return { orgId: sink.org_id, delivered: 0, cursor: sink.cursor_seq, error: error.message };

  const events = (data ?? []) as AdminEvent[];
  if (!events.length) return { orgId: sink.org_id, delivered: 0, cursor: sink.cursor_seq };

  const { data: row } = await db()
    .from("ad_siem_sinks").select("token_cipher").eq("id", sink.id).maybeSingle();
  const token = decrypt(row?.token_cipher ?? null);

  let res: Response;
  try {
    res = await safeFetch(sink.endpoint, {
      method: "POST",
      headers: await headersFor(sink.kind, token),
      body: renderBatch(sink.kind, sink.org_id, events),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const message = (e as Error).message;
    await db().from("ad_siem_sinks").update({ last_error: message }).eq("id", sink.id);
    return { orgId: sink.org_id, delivered: 0, cursor: sink.cursor_seq, error: message };
  }

  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    const message = `collector returned ${res.status}: ${body}`;
    await db().from("ad_siem_sinks").update({ last_error: message }).eq("id", sink.id);
    return { orgId: sink.org_id, delivered: 0, cursor: sink.cursor_seq, error: message };
  }

  const cursor = events[events.length - 1].seq;
  await db().from("ad_siem_sinks")
    .update({ cursor_seq: cursor, last_ok_at: new Date().toISOString(), last_error: null })
    .eq("id", sink.id);
  return { orgId: sink.org_id, delivered: events.length, cursor };
}

/** Every enabled sink. One org's failure must not stop the others. */
export async function exportAll(): Promise<ExportResult[]> {
  const { data, error } = await db()
    .from("ad_siem_sinks")
    .select("id,org_id,kind,endpoint,enabled,cursor_seq,last_ok_at,last_error")
    .eq("enabled", true);
  if (error) throw new Error(`could not list SIEM sinks: ${error.message}`);

  const results: ExportResult[] = [];
  for (const sink of (data ?? []) as SiemSink[]) {
    try {
      results.push(await exportForOrg(sink));
    } catch (e) {
      results.push({ orgId: sink.org_id, delivered: 0, cursor: sink.cursor_seq, error: (e as Error).message });
    }
  }
  return results;
}
