/**
 * Legal hold — suspend retention deletion for runs under a preservation
 * obligation (litigation, regulator request, internal investigation).
 *
 * Retention is otherwise unconditional: enforceRetention() prunes anything past
 * the plan's window, and a customer cannot stop it. For a regulated buyer that
 * is a liability rather than a feature — destroying records subject to a
 * preservation order is spoliation, and "the vendor's retention policy deleted
 * it" is not a defence.
 *
 * Deliberately coarse. A hold either covers the whole org or one agent, with an
 * optional start date. Over-preserving costs storage; under-preserving costs a
 * case, so the scoping stays simple enough to be obviously correct.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, type AuditActor } from "@/lib/adminAudit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface LegalHold {
  id: string;
  reason: string;
  agent_name: string | null;
  covers_from: string | null;
  placed_by: string;
  placed_at: string;
  released_by: string | null;
  released_at: string | null;
}

/** Active holds for an org — the ones retention must respect. */
export async function activeHolds(orgId: string): Promise<LegalHold[]> {
  const { data, error } = await db()
    .from("ad_legal_holds")
    .select("id,reason,agent_name,covers_from,placed_by,placed_at,released_by,released_at")
    .eq("org_id", orgId)
    .is("released_at", null)
    .order("placed_at", { ascending: false });
  if (error) throw new Error(`could not read legal holds: ${error.message}`);
  return (data ?? []) as LegalHold[];
}

export async function listHolds(orgId: string): Promise<LegalHold[]> {
  const { data, error } = await db()
    .from("ad_legal_holds")
    .select("id,reason,agent_name,covers_from,placed_by,placed_at,released_by,released_at")
    .eq("org_id", orgId)
    .order("placed_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`could not read legal holds: ${error.message}`);
  return (data ?? []) as LegalHold[];
}

export async function placeHold(
  orgId: string,
  input: { reason: string; agentName?: string | null; coversFrom?: string | null },
  actor: AuditActor
): Promise<LegalHold> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A legal hold needs a reason — the matter reference or instruction it derives from.");
  const { data, error } = await db()
    .from("ad_legal_holds")
    .insert({
      org_id: orgId,
      reason,
      agent_name: input.agentName?.trim() || null,
      covers_from: input.coversFrom || null,
      placed_by: actor.email ?? "system",
    })
    .select("id,reason,agent_name,covers_from,placed_by,placed_at,released_by,released_at")
    .single();
  if (error || !data) throw new Error(`could not place the legal hold: ${error?.message ?? "insert returned no row"}`);

  await logAdminAction({
    orgId, action: "legal_hold.place", targetType: "legal_hold", targetId: data.id,
    metadata: { reason, agent_name: data.agent_name, covers_from: data.covers_from },
    actor,
  });
  return data as LegalHold;
}

/**
 * Release a hold. Recorded before anything can be deleted under it, because
 * "who lifted the preservation order, and when" is the question asked after
 * records go missing.
 */
export async function releaseHold(orgId: string, holdId: string, actor: AuditActor): Promise<void> {
  const { data, error } = await db()
    .from("ad_legal_holds")
    .update({ released_at: new Date().toISOString(), released_by: actor.email ?? "system" })
    .eq("org_id", orgId)
    .eq("id", holdId)
    .is("released_at", null)
    .select("id,reason")
    .maybeSingle();
  if (error) throw new Error(`could not release the legal hold: ${error.message}`);
  if (!data) throw new Error("No active hold with that id.");

  await logAdminAction({
    orgId, action: "legal_hold.release", targetType: "legal_hold", targetId: holdId,
    metadata: { reason: data.reason },
    actor,
  });
}

/**
 * Does any active hold cover this run?
 *
 * Pure so retention can filter a batch without a query per run. `holds` comes
 * from activeHolds(); an empty list means nothing is preserved.
 */
export function isHeld(
  run: { name?: string | null; started_at?: string | null; created_at?: string | null },
  holds: LegalHold[]
): boolean {
  if (!holds.length) return false;
  const started = run.started_at ?? run.created_at ?? null;
  return holds.some((h) => {
    if (h.agent_name && h.agent_name !== run.name) return false;
    // No timestamp on the run → treat as covered. Preserving something that
    // might be out of scope is recoverable; deleting something in scope is not.
    if (h.covers_from && started && started < h.covers_from) return false;
    return true;
  });
}
