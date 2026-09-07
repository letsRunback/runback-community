/**
 * Feature #5 MVP — a live-ish kill-switch, not just a dashboard alert.
 *
 * Everything else in this codebase that "enforces" is forensic: it records
 * what happened, or blocks a single call against a rule the SDK already
 * holds locally. Nothing before this could reach into a currently-running
 * agent and revoke its authorization based on live divergence. This can —
 * within the latency floor set by the SDK's poll interval plus Vercel
 * Cron's 1-minute granularity, honestly documented as "revoked within the
 * polling window", not sub-second.
 *
 * One row per (org, agent_name) in agent_authorization_state
 * (sql/create_agent_authorization_state.sql). revoked=true is read by the
 * SDK's enforceToolCall pre-hook (packages/sdk/src/collector.ts) via
 * GET /api/agents/authorization-status, and set by the adversarial-guard
 * cron (web/app/api/cron/adversarial-guard) when a sampled replay diverges
 * past threshold — or manually, for an operator who wants to pull the
 * switch immediately rather than wait for the next sampled check.
 */
import { getAdminClient } from "@/lib/supabase/admin";

export interface AuthorizationState {
  revoked: boolean;
  reason: string | null;
  revokedAt: string | null;
}

export async function getAuthorizationState(orgId: string, agentName: string): Promise<AuthorizationState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb
    .from("agent_authorization_state")
    .select("revoked,revoked_reason,revoked_at")
    .eq("org_id", orgId)
    .eq("agent_name", agentName)
    .maybeSingle();
  if (!data) return { revoked: false, reason: null, revokedAt: null };
  return { revoked: !!data.revoked, reason: data.revoked_reason ?? null, revokedAt: data.revoked_at ?? null };
}

export async function setAuthorizationState(
  orgId: string,
  agentName: string,
  revoked: boolean,
  reason: string | null
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  await sb.from("agent_authorization_state").upsert(
    {
      org_id: orgId,
      agent_name: agentName,
      revoked,
      revoked_reason: revoked ? reason : null,
      revoked_at: revoked ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,agent_name" }
  );
}
