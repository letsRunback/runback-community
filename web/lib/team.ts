/**
 * Team management with RBAC. All mutations require the caller to be admin+ in
 * the org; ownership is protected (can't remove/demote the last owner, only an
 * owner can grant owner).
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { issueMagicLink, revokeUserSessions, type Role, atLeast } from "@/lib/auth";
import { logAdminAction, type AuditActor } from "@/lib/adminAudit";
import { sendMagicLink } from "@/lib/email";
import { isHostedService } from "@/lib/deployment";
import { seatStatus } from "@/lib/seats";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  pending?: boolean;
}

export { seatStatus, type SeatStatus } from "@/lib/seats";

export async function listMembers(orgId: string): Promise<Member[]> {
  const sb = db();
  const { data } = await sb
    .from("memberships")
    .select("user_id, role, users(email, name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members: Member[] = (data || []).map((m: any) => ({
    userId: m.user_id,
    email: m.users?.email ?? "",
    name: m.users?.name ?? null,
    role: m.role,
  }));
  // pending invites (tokens not yet used) for this org
  const { data: invites } = await sb
    .from("auth_tokens")
    .select("email, invite_role")
    .eq("org_invite", orgId)
    .eq("used", false);
  const have = new Set(members.map((m) => m.email));
   
  for (const i of invites || []) {
    if (!have.has(i.email)) members.push({ userId: "", email: i.email, name: null, role: i.invite_role || "member", pending: true });
  }
  return members;
}

export type TeamResult = { ok: true } | { ok: false; error: string };

/** Invite a person to the org with a role (admin+ only). Emails a join link. */
export async function inviteMember(
  orgId: string,
  callerRole: Role,
  email: string,
  role: Role,
  baseUrl?: string
): Promise<TeamResult> {
  if (!atLeast(callerRole, "admin")) return { ok: false, error: "You need admin access to invite." };
  if (role === "owner" && callerRole !== "owner") return { ok: false, error: "Only an owner can grant the owner role." };
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  // Fast, honest failure instead of emailing a link that will be turned away
  // at acceptance (consumeMagicLink is the actual enforcement point, since an
  // invite doesn't consume a seat until it's accepted).
  const seats = await seatStatus(orgId);
  if (!seats.available) {
    return { ok: false, error: `Seat limit reached (${seats.used}/${seats.limit}). Remove a member or upgrade your plan to invite more.` };
  }
  const link = await issueMagicLink(email, { orgInvite: orgId, role, baseUrl });
  const sent = await sendMagicLink(email, link, true);
  // Same self-host dead end that app/api/auth/magic/route.ts fixes for sign-in
  // — but this call site was missed. sendMagicLink() silently no-ops when
  // RESEND_API_KEY isn't set (lib/email.ts's send() logs one line and returns
  // false), so on a self-hosted deployment with no email provider configured
  // (the default, and the exact scenario docs/SELF_HOSTING.md walks through)
  // every team invite generated a link that existed only in this variable and
  // was then discarded — the API still answered { ok: true }, so an inviting
  // admin had no indication anything was wrong, and the invited teammate had
  // no way to ever get in. isHostedService() gates it the same way the
  // sign-in route does: the operator reading this log on a self-host already
  // owns the database, but the multi-tenant hosted log is not the inviter's
  // to read.
  if (!sent && !isHostedService()) {
    console.warn(
      `\n[team] No email provider is configured (set RESEND_API_KEY to send these).\n` +
      `[team] Invite link for ${email} (role: ${role}):\n\n    ${link}\n`
    );
  }
  return { ok: true };
}

/** Change a member's role (admin+ only; ownership protected). */
export async function changeRole(orgId: string, callerRole: Role, targetUserId: string, role: Role, actor?: AuditActor): Promise<TeamResult> {
  if (!atLeast(callerRole, "admin")) return { ok: false, error: "You need admin access." };
  if (role === "owner" && callerRole !== "owner") return { ok: false, error: "Only an owner can grant the owner role." };
  const sb = db();
  const { data: target } = await sb.from("memberships").select("role").eq("org_id", orgId).eq("user_id", targetUserId).maybeSingle();
  // An admin can manage members below owner, but never an owner themselves —
  // otherwise any admin could quietly strip a co-owner's role. Only an owner
  // may demote another owner.
  if (target?.role === "owner" && callerRole !== "owner") {
    return { ok: false, error: "Only an owner can change another owner's role." };
  }
  // don't demote the last owner
  if (target?.role === "owner" && role !== "owner") {
    const { count } = await sb.from("memberships").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("role", "owner");
    if ((count ?? 0) <= 1) return { ok: false, error: "Can't demote the last owner." };
  }
  const { error } = await sb.from("memberships").update({ role }).eq("org_id", orgId).eq("user_id", targetUserId);
  if (error) return { ok: false, error: `Could not change the role: ${error.message}` };
  await logAdminAction({ orgId, action: "member.role_change", targetType: "user", targetId: targetUserId,
    metadata: { from: target?.role ?? null, to: role }, actor,
  });
  return { ok: true };
}

/** Remove a member (admin+ only; can't remove the last owner). */
export async function removeMember(orgId: string, callerRole: Role, targetUserId: string, actor?: AuditActor): Promise<TeamResult> {
  if (!atLeast(callerRole, "admin")) return { ok: false, error: "You need admin access." };
  const sb = db();
  const { data: target } = await sb.from("memberships").select("role").eq("org_id", orgId).eq("user_id", targetUserId).maybeSingle();
  // Same reasoning as changeRole: an admin must never be able to remove an
  // owner, even when a co-owner exists to keep the org non-orphaned.
  if (target?.role === "owner" && callerRole !== "owner") {
    return { ok: false, error: "Only an owner can remove another owner." };
  }
  if (target?.role === "owner") {
    const { count } = await sb.from("memberships").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("role", "owner");
    if ((count ?? 0) <= 1) return { ok: false, error: "Can't remove the last owner." };
  }
  const { error } = await sb.from("memberships").delete().eq("org_id", orgId).eq("user_id", targetUserId);
  if (error) return { ok: false, error: `Could not remove the member: ${error.message}` };
  // Access revocation is the single most investigated class of action.
  await logAdminAction({ orgId, action: "member.remove", targetType: "user", targetId: targetUserId,
    metadata: { previous_role: target?.role ?? null }, actor,
  });
  return { ok: true };
}

/** Force sign-out a member's active sessions without removing them from the org (admin+ only). */
export async function revokeMemberSessions(orgId: string, callerRole: Role, targetUserId: string, actor?: AuditActor): Promise<TeamResult> {
  if (!atLeast(callerRole, "admin")) return { ok: false, error: "You need admin access." };
  const sb = db();
  const { data: target } = await sb.from("memberships").select("role").eq("org_id", orgId).eq("user_id", targetUserId).maybeSingle();
  if (target?.role === "owner" && callerRole !== "owner") {
    return { ok: false, error: "Only an owner can sign out another owner." };
  }
  await revokeUserSessions(targetUserId, "admin_revoke", actor?.email ?? actor?.userId ?? "admin");
  await logAdminAction({ orgId, action: "session.revoke", targetType: "user", targetId: targetUserId, actor });
  return { ok: true };
}
