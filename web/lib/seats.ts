/**
 * Seat-limit enforcement. Its own file, not lib/team.ts or lib/entitlements.ts:
 * lib/auth.ts needs it (attachMembership, ensureUserAndOrg, consumeMagicLink
 * all add memberships) and lib/team.ts already imports FROM lib/auth.ts, so
 * putting this in lib/team.ts would make lib/auth.ts import back from a
 * module that imports it — a cycle. lib/entitlements.ts stays a pure,
 * DB-free function library everywhere else; this is the one seat-counting
 * function that necessarily touches the database.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { usageLimits } from "@/lib/entitlements";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface SeatStatus {
  used: number;
  limit: number; // Infinity = unmetered
  available: boolean;
}

/**
 * Seat availability for a new member of an org. `used` counts committed
 * `memberships` rows only — an invite is a pending `auth_tokens` row, not a
 * membership, so a pile of unaccepted invites never permanently reserves
 * seats nobody claimed. The actual enforcement point is therefore
 * acceptance/provisioning (consumeMagicLink, attachMembership, SCIM), not
 * invite creation — callers that create invites only pre-check this for a
 * fast, honest error instead of sending a dead-end email.
 *
 * `PLAN_LIMITS[...].seats` (lib/entitlements.ts) has existed since the plan
 * table was written but was never read anywhere except display — this is the
 * enforcement that was always the point of having the number.
 */
export async function seatStatus(orgId: string): Promise<SeatStatus> {
  const sb = db();
  const [{ count }, { data: org }] = await Promise.all([
    sb.from("memberships").select("*", { count: "exact", head: true }).eq("org_id", orgId),
    sb.from("orgs").select("plan, trial_ends_at").eq("id", orgId).maybeSingle(),
  ]);
  const used = count ?? 0;
  const limit = usageLimits(org || {}).seats;
  return { used, limit, available: limit === Infinity || used < limit };
}
