/**
 * Signed, append-only external security-finding log — persistence layer.
 *
 * See web/lib/securityFindingsCore.ts for the pure hash-chain/signing
 * primitives and why chaining+signing happens in application code rather
 * than a Postgres function (same reasoning as web/lib/narratives.ts: signing
 * needs Node crypto via web/lib/signing.ts, which needs entry_hash to exist
 * first).
 *
 * Concurrency: ad_security_findings has a UNIQUE(org_id, prev_hash)
 * constraint (sql/create_security_findings.sql). appendFinding reads the
 * current tail, builds the chain link, and inserts; on a concurrent-write
 * race (Postgres 23505), it re-reads the new tail and retries — identical
 * pattern to appendNarrative.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getTenantClient } from "@/lib/supabase/tenant";
import { auditHmacKeys } from "@/lib/ledgerCore";
import {
  buildFindingChainLink,
  verifyFinding,
  type FindingSeverity,
  type FindingVerdict,
  type FindingVerification,
} from "@/lib/securityFindingsCore";
import type { Signature } from "@/lib/signing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readDb = (orgId: string) => getTenantClient(orgId).client as any;

const MAX_APPEND_RETRIES = 5;

export interface SecurityFindingRow {
  id: string;
  org_id: string;
  run_id: string | null;
  span_id: string | null;
  vendor: string;
  rule: string;
  severity: FindingSeverity;
  verdict: FindingVerdict;
  detail: string;
  raw_finding: unknown;
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
  signature: Signature;
  created_at: string;
}

async function currentTail(orgId: string): Promise<string> {
  const { data, error } = await db().rpc("security_finding_tail", { p_org: orgId });
  if (error) throw new Error(`[security-findings] could not read chain tail: ${error.message}`);
  return (data as string | null) ?? "";
}

export interface AppendFindingInput {
  orgId: string;
  runId: string | null;
  spanId: string | null;
  vendor: string;
  rule: string;
  severity: FindingSeverity;
  verdict: FindingVerdict;
  detail: string;
  rawFinding: unknown;
}

/**
 * Seal a new finding into the org's chain. Never silently drops an ingested
 * finding on a transient conflict — retries with a fresh tail, throws if
 * every retry is exhausted (a caller that thinks a finding was recorded when
 * it wasn't is worse than an explicit 502 the ingest route can surface).
 */
export async function appendFinding(input: AppendFindingInput): Promise<SecurityFindingRow> {
  for (let attempt = 0; attempt < MAX_APPEND_RETRIES; attempt++) {
    const prevHash = await currentTail(input.orgId);
    const link = buildFindingChainLink({
      org_id: input.orgId,
      run_id: input.runId,
      span_id: input.spanId,
      vendor: input.vendor,
      rule: input.rule,
      severity: input.severity,
      verdict: input.verdict,
      detail: input.detail,
      raw_finding: input.rawFinding,
      prev_hash: prevHash,
    });

    const { data, error } = await db()
      .from("ad_security_findings")
      .insert({
        org_id: input.orgId,
        run_id: input.runId,
        span_id: input.spanId,
        vendor: input.vendor,
        rule: input.rule,
        severity: input.severity,
        verdict: input.verdict,
        detail: input.detail,
        raw_finding: input.rawFinding,
        payload_hash: link.payload_hash,
        prev_hash: link.prev_hash,
        entry_hash: link.entry_hash,
        signature: link.signature,
      })
      .select()
      .single();

    if (!error) return data as SecurityFindingRow;
    if (error.code !== "23505") {
      throw new Error(`[security-findings] append failed: ${error.message}`);
    }
    // 23505 on (org_id, prev_hash) — someone else appended between our read
    // and our insert. Loop and retry against the new tail.
  }
  throw new Error(
    `[security-findings] append failed after ${MAX_APPEND_RETRIES} attempts — persistent chain contention for org ${input.orgId}`
  );
}

export async function getFindingsForRun(orgId: string, runId: string): Promise<SecurityFindingRow[]> {
  const { data, error } = await readDb(orgId)
    .from("ad_security_findings")
    .select("*")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[security-findings] fetch failed: ${error.message}`);
  return (data ?? []) as SecurityFindingRow[];
}

/** Cheap count for the run-detail page's single inline badge — never fetches full rows just to render a number. */
export async function getFindingCountForRun(orgId: string, runId: string): Promise<number> {
  const { count, error } = await readDb(orgId)
    .from("ad_security_findings")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("run_id", runId);
  if (error) throw new Error(`[security-findings] count failed: ${error.message}`);
  return count ?? 0;
}

/** Verify a stored row against its own chain/signature. */
export function verifyStoredFinding(row: SecurityFindingRow): FindingVerification {
  return verifyFinding(
    {
      org_id: row.org_id, run_id: row.run_id, span_id: row.span_id, vendor: row.vendor, rule: row.rule,
      severity: row.severity, verdict: row.verdict, detail: row.detail, raw_finding: row.raw_finding,
      payload_hash: row.payload_hash, prev_hash: row.prev_hash, entry_hash: row.entry_hash, signature: row.signature,
    },
    auditHmacKeys()
  );
}
