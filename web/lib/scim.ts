/**
 * SCIM 2.0 user provisioning (RFC 7644).
 *
 * SSO answers "can this person sign in". SCIM answers "should they still be
 * able to" — it is how an identity provider tells us someone joined or left.
 * Without it, offboarding is manual: a leaver keeps their membership until an
 * admin remembers to remove it, which is the finding every access review
 * produces and the reason SSO-without-SCIM fails enterprise security review.
 *
 * Scope is deliberately narrow. Okta and Entra both provision with
 * POST /Users, deactivate with PATCH active:false, and reconcile with a
 * filtered GET. Those are implemented faithfully; the rest of the spec is not
 * pretended at, because a half-answered SCIM endpoint that returns plausible
 * nonsense is worse than a clearly limited one.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/adminAudit";
import { seatStatus } from "@/lib/seats";
import type { Role } from "@/lib/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  name?: { formatted?: string };
  emails: { value: string; primary: boolean }[];
  active: boolean;
  meta: { resourceType: "User"; created?: string; location?: string };
}

/** A membership row rendered as a SCIM User. `active` is membership, not existence. */
function toScimUser(u: { id: string; email: string; name?: string | null }, active: boolean, created?: string): ScimUser {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: u.id,
    userName: u.email,
    name: u.name ? { formatted: u.name } : undefined,
    emails: [{ value: u.email, primary: true }],
    active,
    meta: { resourceType: "User", created, location: `/api/scim/v2/Users/${u.id}` },
  };
}

export function scimError(status: number, detail: string) {
  return { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail };
}

/**
 * List the org's members. Supports the one filter IdPs actually send during
 * reconciliation: `userName eq "someone@example.com"`.
 */
export async function scimListUsers(
  orgId: string,
  filter?: string | null,
  page?: { startIndex?: number; count?: number }
) {
  type Row = {
    user_id: string;
    created_at: string;
    users: { id: string; email: string; name: string | null } | null;
  };

  const m = filter?.match(/userName\s+eq\s+"([^"]+)"/i);

  // Resolve the filter IN THE DATABASE.
  //
  // This used to read the membership list unfiltered and then match on email in
  // JavaScript. PostgREST caps an unbounded select at 1000 rows, so for an org
  // with more members than that, an IdP looking up a leaver who happened to sit
  // outside the first page got an empty result — indistinguishable from "this
  // person is not in the directory". Okta and Entra both treat that as nothing
  // to do, so the leaver kept their access and no error was raised anywhere.
  if (m) {
    const wanted = m[1].trim().toLowerCase();
    const { data: user, error: uErr } = await db()
      .from("users").select("id").ilike("email", wanted).maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (!user?.id) return emptyList();

    const { data, error } = await db()
      .from("memberships").select("user_id, created_at, users(id, email, name)")
      .eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as Row | null;
    if (!row?.users) return emptyList();
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [toScimUser(row.users, true, row.created_at)],
    };
  }

  // Unfiltered listing: honour SCIM's 1-based startIndex/count rather than
  // ignoring them and reporting a fabricated itemsPerPage.
  const startIndex = Math.max(1, page?.startIndex ?? 1);
  const count = Math.min(Math.max(0, page?.count ?? 200), 1000);
  const from = startIndex - 1;

  const { count: total, error: cErr } = await db()
    .from("memberships").select("user_id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (cErr) throw new Error(cErr.message);

  const { data, error } = await db()
    .from("memberships").select("user_id, created_at, users(id, email, name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .range(from, from + count - 1);
  if (error) throw new Error(error.message);

  const resources = ((data ?? []) as Row[])
    .filter((r) => r.users)
    .map((r) => toScimUser(r.users!, true, r.created_at));

  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total ?? resources.length,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

function emptyList() {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 0,
    startIndex: 1,
    itemsPerPage: 0,
    Resources: [] as ScimUser[],
  };
}

export async function scimGetUser(orgId: string, userId: string): Promise<ScimUser | null> {
  const { data } = await db()
    .from("memberships").select("created_at, users(id, email, name)")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!data?.users) return null;
  return toScimUser(data.users, true, data.created_at);
}

/**
 * Provision a user into the org.
 *
 * Idempotent: an IdP that re-sends a create for someone already provisioned
 * gets the existing user back rather than a duplicate or a 409, because
 * retries are routine and a hard failure would stall the whole sync.
 */
export async function scimCreateUser(
  orgId: string,
  body: { userName?: string; emails?: { value: string }[]; name?: { formatted?: string }; active?: boolean },
  defaultRole: Role = "member"
): Promise<{ user: ScimUser; created: boolean }> {
  const email = (body.userName || body.emails?.[0]?.value || "").trim().toLowerCase();
  if (!email) throw new Error("userName or an email is required");

  const sb = db();
  const { data: existing } = await sb.from("users").select("id,email,name").eq("email", email).maybeSingle();
  let user = existing;
  if (!user) {
    const { data: made, error } = await sb
      .from("users").insert({ email, name: body.name?.formatted ?? null }).select("id,email,name").single();
    if (error || !made) throw new Error(`could not create the user: ${error?.message ?? "insert returned no row"}`);
    user = made;
  }

  const { data: memb } = await sb
    .from("memberships").select("org_id").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  const created = !memb;
  if (created) {
    const seats = await seatStatus(orgId);
    if (!seats.available) {
      // RFC 7644 §3.12 defines "tooMany" for exactly this — a request that
      // would exceed a service-side limit. Thrown, not returned, so it flows
      // through the same catch → scimError() conversion every other failure
      // in this file already uses; POST /Users maps it to a 400 SCIM error.
      throw new Error(`Seat limit reached (${seats.used}/${seats.limit}) — scimType: tooMany`);
    }
    const { error } = await sb.from("memberships").insert({ org_id: orgId, user_id: user.id, role: defaultRole });
    if (error) throw new Error(`could not add the member: ${error.message}`);
    await logAdminAction({
      orgId, action: "member.invite", targetType: "user", targetId: user.id,
      metadata: { email, via: "scim", role: defaultRole },
      actor: { kind: "scim", email, label: "identity provider" },
    });
  }
  return { user: toScimUser(user, true), created };
}

/**
 * Deactivate (PATCH active:false) or reactivate a user.
 *
 * Deactivation removes the membership rather than flagging it: access is the
 * membership, and a "deactivated" row that still grants access is the exact
 * failure an access review is looking for. The user row is left alone — it is
 * referenced by audit history that must stay readable after they leave.
 */
export async function scimSetActive(
  orgId: string, userId: string, active: boolean, defaultRole: Role = "member"
): Promise<boolean> {
  const sb = db();
  const { data: user } = await sb.from("users").select("id,email,name").eq("id", userId).maybeSingle();
  if (!user) return false;

  if (active) {
    // A reactivation only genuinely consumes a seat if they're not already a
    // member — the ignoreDuplicates upsert below is also this function's
    // idempotent "create" path when scimCreateUser and a later active:true
    // PATCH both target the same user, and re-checking membership here (not
    // just relying on the upsert's no-op) is what makes it safe to enforce
    // without also rejecting an IdP's routine re-sync of someone already in.
    const { data: existing } = await sb
      .from("memberships").select("org_id").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
    if (!existing) {
      const seats = await seatStatus(orgId);
      if (!seats.available) {
        throw new Error(`Seat limit reached (${seats.used}/${seats.limit}) — scimType: tooMany`);
      }
    }
    const { error } = await sb
      .from("memberships").upsert({ org_id: orgId, user_id: userId, role: defaultRole }, { onConflict: "org_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(`could not reactivate the member: ${error.message}`);
    await logAdminAction({
      orgId, action: "member.invite", targetType: "user", targetId: userId,
      metadata: { email: user.email, via: "scim", reactivated: true },
      actor: { kind: "scim", email: user.email, label: "identity provider" },
    });
    return true;
  }

  // Never strand an org without an owner, even on an IdP's instruction.
  const { data: target } = await sb.from("memberships").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!target) return false;
  if (target.role === "owner") {
    const { count } = await sb.from("memberships").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("role", "owner");
    if ((count ?? 0) <= 1) throw new Error("Refusing to deprovision the last owner of the organisation.");
  }

  const { error } = await sb.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
  if (error) throw new Error(`could not deprovision the member: ${error.message}`);
  await logAdminAction({
    orgId, action: "member.remove", targetType: "user", targetId: userId,
    metadata: { email: user.email, via: "scim", previous_role: target.role },
    actor: { kind: "scim", email: user.email, label: "identity provider" },
  });
  return true;
}
