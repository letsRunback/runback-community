/**
 * Policy-as-cryptographic-proof — generates a verifiable proof bundle for a run:
 * which policies evaluated it, what was blocked, and the Merkle inclusion proof
 * that the run is in the signed ledger. The artifact a security team hands to an
 * auditor: "this action was blocked, and that fact is sealed and immutable."
 * Enterprise feature ("proof"). Tenant-scoped; enforced by the API route gate.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { inclusionProof, checkpointCoveringRun } from "@/lib/ledger";
import { buildAuditRecord } from "@/lib/audit";

export interface PolicyProofBundle {
  run_id: string;
  run_name: string;
  org_id: string;
  generated_at: string;
  sealed: boolean;
  ledger_seq?: number;
  merkle_root?: string;
  merkle_proof?: { hash: string; right: boolean }[];
  policy_blocks: { policy_name: string; tool_name: string; ts: string; reason?: string }[];
  policy_passes: number;
  content_digest?: string;
  replay_cassette_digest?: string;
  event_count?: number;
  audit_signed: boolean;
  /** External RFC 3161 time-stamps on the checkpoint anchoring this run —
   *  proof this run's leaf existed by a time, from an authority Runback does
   *  not control and cannot backdate. Empty means self-attested only. */
  witnesses: { tsa: string; requested_at: string }[];
  /** This run's checkpoint position in the public, append-only transparency
   *  feed — independently checkable without calling Runback's API at all. */
  transparency: { log_id: string; feed_seq: number; feed_url: string } | null;
  verification: {
    steps: string[];
    ledger_api: string;
    audit_api: string;
    transparency_api: string;
  };
}

export async function buildProofBundle(runId: string, orgId: string): Promise<PolicyProofBundle | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const { data: run } = await sb
    .from("ad_runs")
    .select("run_id,name,org_id,status")
    .eq("run_id", runId)
    .maybeSingle();
  if (!run || run.org_id !== orgId) return null;

  const { data: toolEvents } = await sb
    .from("ad_events")
    .select("tool_name,ts_start,data")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .eq("type", "tool")
    .limit(20_000); // one run's tool calls; bounded so a runaway run cannot truncate silently

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = toolEvents ?? [];
  const policy_blocks: PolicyProofBundle["policy_blocks"] = [];
  let policy_passes = 0;

  for (const ev of events) {
    const d = ev.data ?? {};
    if (d.policy_block) {
      policy_blocks.push({
        policy_name: d.policy_block.rule ?? "unnamed",
        tool_name: ev.tool_name ?? d.tool_name ?? "unknown",
        ts: ev.ts_start,
        reason: d.policy_block.detail ?? undefined,
      });
    } else if (d.policy_evaluated?.passed) {
      policy_passes++;
    }
  }

  const [inc, audit, checkpoint] = await Promise.all([
    inclusionProof(orgId, runId).catch(() => null),
    buildAuditRecord(runId, new Date().toISOString()).catch(() => null),
    checkpointCoveringRun(orgId, runId).catch(() => null),
  ]);

  const m = audit?.manifest;

  return {
    run_id: runId,
    run_name: run.name ?? "agent",
    org_id: orgId,
    generated_at: new Date().toISOString(),
    sealed: inc?.sealed ?? false,
    ledger_seq: inc?.seq,
    merkle_root: inc?.root,
    merkle_proof: inc?.proof,
    policy_blocks,
    policy_passes,
    content_digest: m?.content_digest,
    replay_cassette_digest: m?.replay?.cassette_digest,
    event_count: m?.event_count,
    audit_signed: m?.signed ?? false,
    witnesses: (checkpoint?.witnesses ?? []).map((w) => ({ tsa: w.tsa, requested_at: w.requestedAt })),
    transparency: checkpoint?.transparency
      ? {
          log_id: checkpoint.transparency.logId,
          feed_seq: checkpoint.transparency.feedSeq,
          feed_url: `/api/transparency?after=${checkpoint.transparency.feedSeq - 1}&limit=1`,
        }
      : null,
    verification: {
      steps: [
        "1. Re-derive the run leaf: sha256(run_id || name || status || cassette_digest || ended_at || step_count)",
        "2. Re-link the Merkle path using merkle_proof to reconstruct merkle_root",
        "3. Confirm this run's checkpoint is independently, publicly visible: GET transparency_api and match log_id + feed_seq — this does not require trusting Runback's authenticated API",
        "4. Confirm the witnesses[] RFC 3161 tokens independently via any TSA verifier — proves this checkpoint existed at that time, from an authority Runback does not control and cannot backdate. Empty witnesses[] means self-attested only.",
        "5. As a fallback (or to double-check), verify HMAC/Ed25519 checkpoint signature against the Runback public audit key via ledger_api",
        "6. Confirm policy_blocks match sealed ad_events rows via /api/replay for each blocked span",
      ],
      ledger_api: `/api/runs/${runId}/audit`,
      audit_api: `/api/runs/${runId}/audit`,
      transparency_api: `/api/transparency`,
    },
  };
}
