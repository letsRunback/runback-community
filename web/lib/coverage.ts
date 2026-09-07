/**
 * Governance coverage — how much of the estate is actually under observation.
 *
 * This is the number a Chief Risk Officer reports upward, and the reason it is
 * worth building carefully: it is the difference between a tool a team uses and
 * a programme an organisation runs.
 *
 * The denominator comes from the customer's declared inventory, never from what
 * already reports to us. Derived from observed runs alone, coverage is always
 * 100% — a reassuring number that cannot fall, which is worse than no number.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, type AuditActor } from "@/lib/adminAudit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export type CoverageStatus = "covered" | "stale" | "uninstrumented" | "undeclared";

export interface AgentCoverageRow {
  name: string;
  status: CoverageStatus;
  owner: string | null;
  criticality: "critical" | "high" | "standard" | "low";
  runs: number;
  last_seen: string | null;
}

export interface CoverageSummary {
  /** Declared, currently reporting. */
  covered: number;
  /** Declared, reported once, now silent — capture broke or it was retired quietly. */
  stale: number;
  /** Declared, never seen — the coverage gap. */
  uninstrumented: number;
  /** Observed but absent from the inventory — shadow AI. */
  undeclared: number;
  /** Size of the declared inventory (covered + stale + uninstrumented). */
  declared: number;
  /** covered / declared. Null when nothing has been declared — no inventory, no claim. */
  coverageRate: number | null;
  /** Declared critical/high agents that are not currently reporting. */
  criticalGaps: AgentCoverageRow[];
  /** Observed but absent from the inventory — shadow AI, surfaced for alerting, not just the count. */
  undeclaredRows: AgentCoverageRow[];
  rows: AgentCoverageRow[];
}

/**
 * `staleHoursCritical` exists separately from `staleDays` because a
 * day-scale threshold is far too slow for a critical agent: two weeks of
 * silence from something declared critical is either a bad outage nobody
 * noticed, or an agent that started bypassing Runback entirely — both worth
 * knowing about in hours, not weeks. Standard/low-criticality agents keep
 * the day-scale default, where anything faster would just be noise from
 * ordinary idle periods.
 */
export async function agentCoverage(orgId: string, staleDays = 14, staleHoursCritical = 24): Promise<CoverageSummary> {
  const { data, error } = await db().rpc("agent_coverage", { p_org: orgId, p_stale_days: staleDays, p_stale_hours_critical: staleHoursCritical });
  if (error) throw new Error(`could not compute agent coverage: ${error.message}`);

  const rows = ((data ?? []) as AgentCoverageRow[]).map((r) => ({ ...r, runs: Number(r.runs) }));
  const count = (s: CoverageStatus) => rows.filter((r) => r.status === s).length;

  const covered = count("covered");
  const stale = count("stale");
  const uninstrumented = count("uninstrumented");
  const declared = covered + stale + uninstrumented;

  return {
    covered,
    stale,
    uninstrumented,
    undeclared: count("undeclared"),
    declared,
    // Explicitly null rather than 0 or 100: an org that has declared nothing has
    // not achieved full coverage, and has not failed either. It has no inventory.
    coverageRate: declared > 0 ? covered / declared : null,
    // A silent critical agent is the finding worth leading with — it is either
    // an unmonitored high-risk system or a broken capture nobody noticed.
    criticalGaps: rows.filter(
      (r) => (r.criticality === "critical" || r.criticality === "high") &&
             (r.status === "uninstrumented" || r.status === "stale")
    ),
    undeclaredRows: rows.filter((r) => r.status === "undeclared"),
    rows,
  };
}

export interface DeclareInput {
  name: string;
  owner?: string | null;
  criticality?: AgentCoverageRow["criticality"];
  systemOfRecord?: string | null;
}

/**
 * Add agents to the inventory. Idempotent per name so re-importing a CMDB
 * export updates rather than duplicating or failing halfway.
 */
export async function declareAgents(
  orgId: string,
  agents: DeclareInput[],
  actor: AuditActor
): Promise<number> {
  const rows = agents
    .map((a) => ({
      org_id: orgId,
      name: a.name.trim(),
      owner: a.owner?.trim() || null,
      criticality: a.criticality ?? "standard",
      system_of_record: a.systemOfRecord?.trim() || null,
      declared_by: actor.email ?? "system",
      retired_at: null,
      retired_by: null,
    }))
    .filter((a) => a.name);
  if (!rows.length) return 0;

  const { error } = await db()
    .from("ad_agent_registry")
    .upsert(rows, { onConflict: "org_id,name" });
  if (error) throw new Error(`could not declare agents: ${error.message}`);

  await logAdminAction({
    orgId, action: "org.settings_change", targetType: "agent_registry", targetId: "declare",
    metadata: { count: rows.length, names: rows.slice(0, 20).map((r) => r.name) },
    actor,
  });
  return rows.length;
}

/**
 * Retire an agent rather than deleting it: one that existed during an audited
 * period has to stay explicable afterwards.
 */
export async function retireAgent(orgId: string, name: string, actor: AuditActor): Promise<void> {
  const { data, error } = await db()
    .from("ad_agent_registry")
    .update({ retired_at: new Date().toISOString(), retired_by: actor.email ?? "system" })
    .eq("org_id", orgId).eq("name", name).is("retired_at", null)
    .select("name").maybeSingle();
  if (error) throw new Error(`could not retire the agent: ${error.message}`);
  if (!data) throw new Error("No active agent by that name.");

  await logAdminAction({
    orgId, action: "org.settings_change", targetType: "agent_registry", targetId: name,
    metadata: { retired: true }, actor,
  });
}
