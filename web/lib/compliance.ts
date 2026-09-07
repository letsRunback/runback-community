/**
 * Compliance artifact generation — produces a structured, audit-ready report
 * for a given date range covering: runs completed, policy enforcements (blocks),
 * ledger integrity, and a machine-verifiable attestation block.
 * Enterprise feature ("compliance"). All queries strictly org-scoped.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getTenantClient } from "@/lib/supabase/tenant";
import { ledgerStatus, verifyLedger } from "@/lib/ledger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readDb = (orgId: string) => getTenantClient(orgId).client as any;

export interface PolicyEnforcement {
  policy_name: string;
  blocks: number;
  last_block_at: string | null;
}

export interface ComplianceReport {
  org_id: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  runs: {
    total: number;
    success: number;
    errors: number;
    errorRate: number;
    avgStepsPerRun: number;
    totalTokens: number;
  };
  policies: {
    total: number;
    enforcements: PolicyEnforcement[];
    totalBlocks: number;
    /** Calls the enforcement engine actually evaluated (allowed + blocked) — evidence it ran, not just that it fired. */
    totalEvaluations: number;
  };
  ledger: {
    entries: number;
    intact: boolean | null;
    intactNote: string | null;
    sealed: boolean;
    lastCheckpointAt: string | null;
  };
  redactions: {
    total: number;
    /** Rule name → count across the period, e.g. {"email": 12, "ssn": 3}. */
    byType: Record<string, number>;
    note: string;
  };
  attestation: {
    schema: "runback-compliance-v1";
    note: string;
  };
}

/**
 * Illustrative only — a non-entitled org (and the public showcase demo
 * account, which is unlocked but must never surface its own real seeded
 * numbers as if they were a genuine evidence package) must never see real
 * compliance numbers. period_start/period_end are filled in per-request so
 * the header dates still match the selected window. Shared by the page and
 * its download-evidence-package API route so what's on screen always matches
 * what gets downloaded.
 */
export function illustrativeComplianceReport(periodStart: string, periodEnd: string, generatedAt: string): ComplianceReport {
  return {
    org_id: "sample",
    period_start: periodStart,
    period_end: periodEnd,
    generated_at: generatedAt,
    runs: { total: 4820, success: 4622, errors: 198, errorRate: 0.041, avgStepsPerRun: 4.2, totalTokens: 6_140_000 },
    policies: {
      total: 12, totalBlocks: 37, totalEvaluations: 4820,
      enforcements: [
        { policy_name: "no_refund_over_100", blocks: 21, last_block_at: periodEnd },
        { policy_name: "no_pii_in_output", blocks: 16, last_block_at: periodEnd },
      ],
    },
    ledger: { entries: 4820, intact: true, intactNote: null, sealed: true, lastCheckpointAt: periodEnd },
    redactions: { total: 312, byType: { email: 201, card: 74, ssn: 37 }, note: "Illustrative — redacted in-process before storage." },
    attestation: { schema: "runback-compliance-v1", note: "Sample report — upgrade to generate your org's real evidence package." },
  };
}

export async function generateComplianceReport(
  orgId: string,
  periodStart: string,
  periodEnd: string,
  demo = false
): Promise<ComplianceReport> {
  const sb = readDb(orgId);
  const startTs = new Date(periodStart + "T00:00:00Z").toISOString();
  const endTs = new Date(periodEnd + "T23:59:59Z").toISOString();

  // Aggregated in the database, not by shipping rows here.
  //
  // This block used to fetch up to 10,000 run rows and sum them, then compute
  // policy enforcement from runs.slice(0, 1000). Both truncations were silent,
  // so an org with more than a thousand runs in the period received a report
  // whose "Calls evaluated" and "Total blocks" covered a fraction of it and
  // said so nowhere. Measured on 2,500 runs: 200 blocks reported against 500
  // actual, and 1,000 evaluations against 2,500.
  //
  // A wrong dashboard is a bug. A wrong number in the document a customer hands
  // a regulator is the product failing at the only thing it sells. Raising the
  // limits moves the cliff; aggregating server-side removes it.
  const [summaryRes, ledgerRes, verification, policiesRes] = await Promise.all([
    sb.rpc("compliance_summary", { p_org: orgId, p_start: startTs, p_end: endTs }),
    ledgerStatus(orgId, demo).catch(() => null),
    // Re-derives every leaf from the current run rows — the actual tamper
    // check, not just a count. Slower than ledgerStatus; fine for an
    // on-demand report, not something to call on a hot path.
    verifyLedger(orgId, demo).catch(() => null),
    sb.from("ad_policies").select("name,version").eq("org_id", orgId),
  ]);

  // A failed aggregate must not read as a compliant org with nothing to report.
  if (summaryRes.error) {
    throw new Error(`Could not compute the compliance summary: ${summaryRes.error.message}`);
  }
  const sum = (summaryRes.data ?? {}) as {
    runs_total?: number; runs_success?: number; runs_errors?: number;
    tokens_total?: number; steps_total?: number; redactions_total?: number;
    redactions_by_type?: Record<string, number>;
    policy_evaluations?: number; policy_blocks?: number;
    blocks_by_policy?: { policy_name: string; blocks: number; last_block_at: string | null }[];
  };

  const totalRuns = sum.runs_total ?? 0;
  const successRuns = sum.runs_success ?? 0;
  const errorRuns = sum.runs_errors ?? 0;
  const totalTokens = sum.tokens_total ?? 0;
  const totalSteps = sum.steps_total ?? 0;
  const totalRedactions = sum.redactions_total ?? 0;
  const redactionsByType: Record<string, number> = sum.redactions_by_type ?? {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const policies: any[] = policiesRes.data ?? [];

  const enforcements: PolicyEnforcement[] = (sum.blocks_by_policy ?? []).map((b) => ({
    policy_name: b.policy_name,
    blocks: b.blocks,
    last_block_at: b.last_block_at,
  }));
  const totalBlocks = sum.policy_blocks ?? 0;
  const totalEvaluations = sum.policy_evaluations ?? 0;

  const ledger = {
    entries: ledgerRes?.count ?? 0,
    intact: verification?.intact ?? null,
    intactNote: verification?.note ?? null,
    sealed: ledgerRes?.signed ?? false,
    lastCheckpointAt: ledgerRes?.lastCheckpointAt ?? null,
  };

  return {
    org_id: orgId,
    period_start: periodStart,
    period_end: periodEnd,
    generated_at: new Date().toISOString(),
    runs: { total: totalRuns, success: successRuns, errors: errorRuns, errorRate: totalRuns > 0 ? errorRuns / totalRuns : 0, avgStepsPerRun: totalRuns > 0 ? Math.round(totalSteps / totalRuns) : 0, totalTokens },
    policies: { total: policies.length, enforcements, totalBlocks, totalEvaluations: totalEvaluations ?? 0 },
    ledger,
    redactions: {
      total: totalRedactions,
      byType: redactionsByType,
      note: "Self-reported by the SDK at capture time — redaction happens in your process before anything is sent, so Runback never sees the raw value to independently verify against.",
    },
    attestation: {
      schema: "runback-compliance-v1",
      note: "Generated by Runback. Ledger intactness is independently re-derived from current run rows at generation time, not assumed. Policy enforcement records are derived from sealed ad_events rows.",
    },
  };
}

export async function cacheReport(orgId: string, report: ComplianceReport, userId?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  await sb.from("ad_compliance_reports").upsert({
    org_id: orgId,
    period_start: report.period_start,
    period_end: report.period_end,
    report,
    generated_at: report.generated_at,
    generated_by: userId ?? null,
  }, { onConflict: "org_id,period_start,period_end" });
}
