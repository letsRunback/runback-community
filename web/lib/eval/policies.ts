/**
 * Versioned, org-scoped policies. Each save is an immutable new version; the
 * "current" policy is the max version for a name. Evals reference a specific
 * version id, so the gate records exactly what it enforced.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { assertValidPolicy, type Policy, type PolicyRule } from "./policy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface PolicyRow { id: string; name: string; version: number; rules: PolicyRule[]; created_at: string }

/** Current (latest) version of every policy in the org. */
export async function listPolicies(orgId: string): Promise<PolicyRow[]> {
  const { data } = await db()
    .from("ad_policies")
    .select("id,name,version,rules,created_at")
    .eq("org_id", orgId)
    .order("version", { ascending: false });
  const seen = new Set<string>();
  const out: PolicyRow[] = [];
  for (const r of (data ?? []) as PolicyRow[]) {
    if (seen.has(r.name)) continue;   // first per name = highest version
    seen.add(r.name); out.push(r);
  }
  return out;
}

/**
 * Load one policy version by id, or null if it doesn't exist — or belongs to a
 * different org than the caller. Pass the session/eval org to enforce isolation
 * (null-org policies stay open).
 */
export async function getPolicy(id: string, orgId?: string | null): Promise<PolicyRow | null> {
  const { data } = await db().from("ad_policies").select("id,name,version,rules,created_at,org_id").eq("id", id).maybeSingle();
  if (!data) return null;
  if (data.org_id && data.org_id !== orgId) return null; // tenant isolation
  return data as PolicyRow;
}

/** Save a policy as a new immutable version. Returns the new row. */
export async function savePolicy(orgId: string, name: string, rules: PolicyRule[]): Promise<PolicyRow> {
  const policy = { name, version: 1, rules } as Policy;
  assertValidPolicy(policy);
  const { data: cur } = await db()
    .from("ad_policies").select("version").eq("org_id", orgId).eq("name", name)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (cur?.version ?? 0) + 1;
  const { data, error } = await db()
    .from("ad_policies")
    .insert({ org_id: orgId, name, version, rules })
    .select("id,name,version,rules,created_at").single();
  // Two concurrent saves to the same policy name both read the same "current
  // version" and race to insert version N+1 — the (org_id,name,version)
  // unique constraint stops the loser, but until this check existed the
  // error was discarded entirely: `data` came back null, silently typed as
  // PolicyRow, and the caller's next `.name` access threw a confusing
  // TypeError instead of "someone else just saved this — reload and retry."
  if (error) {
    throw new Error(
      error.code === "23505"
        ? "Someone else just saved a new version of this policy — reload and try again."
        : "Could not save the policy — try again."
    );
  }

  // A policy decides what the agent is allowed to do, so changing one is a
  // governance event — /security lists policy changes among the operator
  // actions written to the hash-chained log, and none ever were. Recorded here
  // rather than in the route so every caller is covered, and typed by whether
  // this is the first version or a later one (the table is append-only, so an
  // "update" is a new version rather than a mutation).
  const { logAdminAction } = await import("@/lib/adminAudit");
  await logAdminAction({
    orgId,
    action: version === 1 ? "policy.create" : "policy.update",
    targetType: "policy",
    targetId: String((data as PolicyRow | null)?.id ?? name),
    metadata: { name, version, rule_count: rules.length },
  });

  return data as PolicyRow;
}
