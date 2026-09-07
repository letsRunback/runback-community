import { getAdminClient } from "@/lib/supabase/admin";

export interface ApprovalContext {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  run_name?: string;
  model?: string;
  [key: string]: unknown;
}

export interface ApprovalRow {
  id: string;
  org_id: string;
  run_id: string;
  span_id?: string | null;
  policy_name?: string | null;
  rule_id?: string | null;
  rule_desc?: string | null;
  context: ApprovalContext;
  status: "pending" | "approved" | "rejected" | "timed_out";
  decision_note?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  expires_at?: string | null;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function createApproval(
  row: Pick<ApprovalRow, "org_id" | "run_id" | "span_id" | "policy_name" | "rule_id" | "rule_desc" | "context" | "expires_at">
): Promise<ApprovalRow | null> {
  const { data } = await db().from("approvals").insert(row).select().single();
  return data ?? null;
}

export async function getApproval(id: string, orgId: string): Promise<ApprovalRow | null> {
  const { data } = await db()
    .from("approvals").select("*")
    .eq("id", id).eq("org_id", orgId)
    .maybeSingle();
  return data ?? null;
}

export async function listApprovals(
  orgId: string,
  status?: ApprovalRow["status"]
): Promise<ApprovalRow[]> {
  let q = db()
    .from("approvals").select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return data ?? [];
}

export async function decideApproval(
  id: string,
  orgId: string,
  decision: "approved" | "rejected",
  note: string,
  decidedBy: string,
): Promise<ApprovalRow | null> {
  const { data } = await db()
    .from("approvals")
    .update({
      status: decision,
      decision_note: note || null,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("status", "pending")
    .select()
    .single();
  return data ?? null;
}

export async function pendingCount(orgId: string): Promise<number> {
  const { count } = await db()
    .from("approvals")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "pending");
  return count ?? 0;
}

export async function expireStaleApprovals(): Promise<number> {
  const { data } = await db()
    .from("approvals")
    .update({ status: "timed_out" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  return data?.length ?? 0;
}

export async function orgAdminEmails(orgId: string): Promise<string[]> {
  // memberships join users — the actual table names in this schema
  const { data } = await db()
    .from("memberships")
    .select("role, users!inner(email)")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => r.users?.email).filter(Boolean) as string[];
}
