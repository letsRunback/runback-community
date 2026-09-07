/**
 * Raise governance findings as records in the customer's own workflow system.
 *
 * Enterprises do not adopt another dashboard; they adopt what appears in the
 * queue they already work. A policy block that exists only in Runback is a
 * finding nobody owns. The same block as a ServiceNow incident has an assignee,
 * an SLA and an audit trail their process already understands.
 *
 * It is also what turns a subscription into infrastructure: once findings flow
 * into ServiceNow, removing Runback means unpicking a workflow.
 */
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { safeFetch } from "@/lib/ssrfGuard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export type WorkflowKind = "servicenow" | "jira" | "pagerduty" | "webhook";
export type FindingKind = "ledger_tamper" | "critical_gap" | "policy_block" | "shadow_agent" | "sdk_bypass";
export type Urgency = "critical" | "high" | "normal";

export interface WorkflowSink {
  id: string;
  org_id: string;
  kind: WorkflowKind;
  endpoint: string;
  project_key: string | null;
  enabled: boolean;
  on_ledger_tamper: boolean;
  on_critical_gap: boolean;
  on_shadow_agent: boolean;
  on_sdk_bypass: boolean;
  on_policy_block: boolean;
  policy_block_threshold: number;
  last_ok_at: string | null;
  last_error: string | null;
}

export interface Finding {
  kind: FindingKind;
  /** Stable identity of the FINDING, not the occurrence — this is what dedupes. */
  dedupeKey: string;
  title: string;
  detail: string;
  urgency: Urgency;
  /** Deep link back into Runback, so the record is actionable from the queue. */
  link?: string;
}

/* ── secret at rest ───────────────────────────────────────────────────────── */

function secretKey(): Buffer {
  const s = process.env.WORKFLOW_SECRET_KEY || process.env.MODEL_KEY_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error("WORKFLOW_SECRET_KEY must be set to store workflow credentials in production.");
    }
    console.warn("[workflow] no WORKFLOW_SECRET_KEY set — using a DEV-ONLY key.");
    return crypto.createHash("sha256").update("runback-dev-workflow-secret").digest();
  }
  return crypto.createHash("sha256").update(s).digest();
}

export function encryptAuth(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

function decryptAuth(blob: string | null): string | null {
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

/* ── vendor payloads ──────────────────────────────────────────────────────── */

/** ServiceNow urgency/impact are 1=high … 3=low, not strings. */
const SNOW_URGENCY: Record<Urgency, string> = { critical: "1", high: "2", normal: "3" };
/** PagerDuty accepts a fixed severity vocabulary; "normal" is not in it. */
const PD_SEVERITY: Record<Urgency, string> = { critical: "critical", high: "error", normal: "warning" };

/**
 * Jira Cloud's v3 API requires Atlassian Document Format for `description`.
 * A plain string is rejected with a 400 that reads like a permissions problem,
 * so this is a place integrations quietly never work.
 */
export function toAdf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.split("\n").filter(Boolean).map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

export function buildRequest(
  sink: WorkflowSink,
  f: Finding,
  auth: string | null
): { url: string; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const base = sink.endpoint.replace(/\/+$/, "");
  /** Host of a possibly-malformed configured URL; "" when it will not parse. */
  const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };
  const detail = f.link ? `${f.detail}\n\nOpen in Runback: ${f.link}` : f.detail;

  if (sink.kind === "servicenow") {
    if (auth) headers.authorization = `Basic ${Buffer.from(auth).toString("base64")}`;
    return {
      url: `${base}/api/now/table/${sink.project_key || "incident"}`,
      headers,
      body: JSON.stringify({
        short_description: f.title,
        description: detail,
        urgency: SNOW_URGENCY[f.urgency],
        impact: SNOW_URGENCY[f.urgency],
        category: "AI governance",
        // Lets ServiceNow correlate re-raises with what we already sent.
        correlation_id: f.dedupeKey,
      }),
    };
  }

  if (sink.kind === "jira") {
    if (auth) headers.authorization = `Basic ${Buffer.from(auth).toString("base64")}`;
    // "PROJ" → issue type Task; "PROJ/Bug" → issue type Bug. Encoded in the
    // existing column so this needs no migration and no reconfiguration for
    // anyone already working.
    const [projectKey, ...typeParts] = (sink.project_key ?? "").split("/");
    const issueType = typeParts.join("/").trim() || "Task";
    return {
      url: `${base}/rest/api/3/issue`,
      headers,
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: f.title,
          description: toAdf(detail),
          // "Task" is not universal. Company-managed enterprise projects often
          // do not define it, or gate it behind mandatory fields, and Jira
          // answers 400 — so every ticket silently failed to create on exactly
          // the deployments most likely to want them. Configurable as
          // "PROJ/Issue Type"; still defaults to Task.
          issuetype: { name: issueType },
          labels: ["runback", `runback-${f.kind}`],
        },
      }),
    };
  }

  if (sink.kind === "pagerduty") {
    return {
      // Hard-coding the US host broke the EU service region
      // (events.eu.pagerduty.com) and any proxied deployment.
      //
      // `endpoint` is shared across sink kinds, so a PagerDuty sink can carry a
      // leftover value meant for something else — taking it unconditionally
      // would silently redirect alerts at whatever is in that column. Only
      // honour it when it actually looks like a PagerDuty Events host.
      url: /(^|\.)pagerduty\.com$/i.test(hostOf(base))
        ? `${base}/v2/enqueue`
        : "https://events.pagerduty.com/v2/enqueue",
      headers,
      body: JSON.stringify({
        routing_key: auth,
        event_action: "trigger",
        // PagerDuty dedupes server-side on this too, so a retry cannot double-page.
        dedup_key: f.dedupeKey,
        payload: {
          summary: f.title,
          severity: PD_SEVERITY[f.urgency],
          source: "runback",
          custom_details: { detail: f.detail, link: f.link, finding: f.kind },
        },
      }),
    };
  }

  if (auth) headers.authorization = `Bearer ${auth}`;
  return {
    url: base,
    headers,
    body: JSON.stringify({ finding: f.kind, title: f.title, detail: f.detail, urgency: f.urgency, link: f.link, dedupe_key: f.dedupeKey }),
  };
}

/** Pull the record id out of the vendor's response, for the link back. */
export function externalRef(kind: WorkflowKind, body: unknown): { id: string | null; url: string | null } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  if (kind === "servicenow") return { id: b?.result?.number ?? b?.result?.sys_id ?? null, url: null };
  if (kind === "jira") return { id: b?.key ?? null, url: b?.self ?? null };
  if (kind === "pagerduty") return { id: b?.dedup_key ?? null, url: null };
  return { id: null, url: null };
}

/* ── raising ──────────────────────────────────────────────────────────────── */

export async function getWorkflowSink(orgId: string): Promise<WorkflowSink | null> {
  const { data, error } = await db()
    .from("ad_workflow_sinks")
    .select("id,org_id,kind,endpoint,project_key,enabled,on_ledger_tamper,on_critical_gap,on_shadow_agent,on_sdk_bypass,on_policy_block,policy_block_threshold,last_ok_at,last_error")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`could not read the workflow configuration: ${error.message}`);
  return (data ?? null) as WorkflowSink | null;
}

/** Does this sink want this finding? */
export function wants(sink: WorkflowSink, f: Finding, occurrences = 1): boolean {
  if (!sink.enabled) return false;
  if (f.kind === "ledger_tamper") return sink.on_ledger_tamper;
  if (f.kind === "critical_gap") return sink.on_critical_gap;
  if (f.kind === "shadow_agent") return sink.on_shadow_agent;
  if (f.kind === "sdk_bypass") return sink.on_sdk_bypass;
  // Policy blocks are routine. Raising one per block would bury the queue and
  // get the integration switched off — the same outcome as never building it.
  if (f.kind === "policy_block") return sink.on_policy_block && occurrences >= sink.policy_block_threshold;
  return false;
}

export interface RaiseResult {
  raised: boolean;
  reason?: string;
  externalId?: string | null;
}

/**
 * Raise a finding, once.
 *
 * The claim is atomic, so two concurrent detections of the same problem cannot
 * both open a ticket. A finding already open is counted, not re-raised.
 */
export async function raiseFinding(orgId: string, f: Finding): Promise<RaiseResult> {
  const sink = await getWorkflowSink(orgId).catch(() => null);
  if (!sink) return { raised: false, reason: "no workflow sink configured" };

  const { data: claim, error: claimErr } = await db().rpc("claim_workflow_record", {
    p_org: orgId, p_key: f.dedupeKey, p_kind: f.kind,
  });
  if (claimErr) return { raised: false, reason: `could not claim the finding: ${claimErr.message}` };
  const row = Array.isArray(claim) ? claim[0] : claim;
  const occurrences = Number(row?.occurrences ?? 1);

  if (!wants(sink, f, occurrences)) return { raised: false, reason: "sink does not want this finding" };
  if (!row?.should_raise) return { raised: false, reason: `already open (seen ${occurrences}x)` };

  const { data: secretRow } = await db()
    .from("ad_workflow_sinks").select("auth_cipher").eq("id", sink.id).maybeSingle();
  const auth = decryptAuth(secretRow?.auth_cipher ?? null);

  const req = buildRequest(sink, f, auth);
  try {
    // safeFetch, not fetch: req.url is built from a customer-configured sink
    // endpoint (Jira/ServiceNow/PagerDuty base), so it is an SSRF sink like the
    // SIEM and alert targets. This module previously had no guard at all.
    const res = await safeFetch(req.url, {
      method: "POST", headers: req.headers, body: req.body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      const message = `${sink.kind} returned ${res.status}: ${text}`;
      await db().from("ad_workflow_sinks").update({ last_error: message }).eq("id", sink.id);
      // The claim stays open so the next detection retries rather than the
      // finding being permanently swallowed by one failed call.
      return { raised: false, reason: message };
    }
    const body = await res.json().catch(() => ({}));
    const ref = externalRef(sink.kind, body);
    await db().from("ad_workflow_records")
      .update({ external_id: ref.id, external_url: ref.url })
      .eq("org_id", orgId).eq("dedupe_key", f.dedupeKey).is("closed_at", null);
    await db().from("ad_workflow_sinks")
      .update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("id", sink.id);
    return { raised: true, externalId: ref.id };
  } catch (e) {
    const message = (e as Error).message;
    await db().from("ad_workflow_sinks").update({ last_error: message }).eq("id", sink.id);
    return { raised: false, reason: message };
  }
}
