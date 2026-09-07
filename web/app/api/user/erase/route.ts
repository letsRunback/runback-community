/**
 * GDPR Art.17 right to erasure — self-service account deletion.
 *
 * Deletes the authenticated user's personal data:
 *   - Auth tokens and sessions
 *   - Orgs where the user is the sole member (cascades to runs, events, API keys)
 *   - Membership in orgs with other members (leaves org intact)
 *   - User record itself
 */
import { NextResponse } from "next/server";
import { getSession, destroySession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { tombstoneRuns } from "@/lib/ledger";
import { readAll } from "@/lib/supabase/read";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Require explicit confirmation to guard against CSRF triggering accidental deletion.
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.confirm !== "DELETE MY ACCOUNT") {
    return NextResponse.json(
      { error: "Send { confirm: 'DELETE MY ACCOUNT' } to proceed." },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { userId, email } = session;

  // 1. Invalidate sessions and auth tokens immediately.
  await sb.from("sessions").delete().eq("user_id", userId);
  await sb.from("auth_tokens").delete().eq("email", email);

  // 1b. GDPR Art.17: delete all PII from marketing tables keyed on email,
  //     which are not linked via FK to users.id and thus won't cascade.
  await sb.from("newsletter_subscribers").delete().eq("email", email.toLowerCase());
  await sb.from("leads").delete().eq("email", email.toLowerCase());

  // 2. Find all orgs where this user is a member.
  const { data: memberships } = await sb
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", userId);

  for (const m of memberships || []) {
    const orgId = m.org_id as string;

    // Count total members in this org.
    const { count } = await sb
      .from("memberships")
      .select("*", { count: "exact", head: true })
      .eq("org_id", orgId);

    if (count === 1) {
      // Sole member — purge all org data then delete the org.
      // Every other run-deleting path in this codebase calls tombstoneRuns()
      // first (see lib/ledger.ts) so verifyLedger can tell "deleted by our
      // own policy" apart from "deleted by an attacker" — this path didn't,
      // leaving a window between this delete and the org delete below where
      // a verifyLedger() call would misreport tampering for a legitimate
      // erasure. Unlike enforceRetention() (which can skip a batch and retry
      // next sweep), a GDPR Art.17 request can't be blocked on a tombstone
      // write failing — erasure is the legal requirement here, so this is
      // best-effort: log and proceed either way. ad_ledger_tombstones has no
      // FK to orgs, so the record survives even after the org row (and its
      // ledger) are gone via cascade below.
      // Paged, not a bare unbounded select: a truncated prefix here means an
      // unexplained (not just untombstoned) tail of runs once the org is gone.
      const orgRuns = await readAll<{ run_id: string }>(
        (from, to) => sb.from("ad_runs").select("run_id").eq("org_id", orgId).range(from, to),
        "erase: list org runs for tombstoning"
      );
      const runIds = orgRuns.map((r) => r.run_id);
      if (runIds.length) {
        const ok = await tombstoneRuns(orgId, runIds, "gdpr_erase");
        if (!ok) console.error(`[erase] tombstone write failed for org ${orgId} — proceeding with erasure anyway (GDPR Art.17 can't be blocked on it).`);
      }
      // ad_events cascade-deletes via FK on ad_runs.run_id.
      await sb.from("ad_runs").delete().eq("org_id", orgId);
      // Delete remaining org-scoped tables not covered by CASCADE from orgs.
      await sb.from("plg_events").delete().eq("org_id", orgId);
      await sb.from("usage_counters").delete().eq("org_id", orgId);
      // Org delete cascades to: memberships, api_keys, alert_rules, sessions (by org),
      // and any other table with org_id FK + ON DELETE CASCADE.
      await sb.from("orgs").delete().eq("id", orgId);
    } else {
      // Shared org. A right-to-erasure request can't be refused because the
      // requester happens to be the org's only owner (unlike lib/team.ts's
      // changeRole/removeMember, which correctly refuse an admin-initiated
      // demotion of the last owner) — but leaving the org permanently ownerless
      // is also not acceptable, so promote a successor first when this user is
      // the sole owner.
      if (m.role === "owner") {
        const { count: ownerCount } = await sb
          .from("memberships")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("role", "owner");
        if ((ownerCount ?? 0) <= 1) {
          const { data: others } = await sb
            .from("memberships")
            .select("user_id, role, created_at")
            .eq("org_id", orgId)
            .neq("user_id", userId);
          const RANK: Record<string, number> = { admin: 3, member: 2, viewer: 1 };
          const successor = (others ?? [])
            .sort((a: { role: string; created_at: string }, b: { role: string; created_at: string }) =>
              (RANK[b.role] ?? 0) - (RANK[a.role] ?? 0) || a.created_at.localeCompare(b.created_at))[0];
          if (successor) {
            await sb.from("memberships").update({ role: "owner" }).eq("org_id", orgId).eq("user_id", successor.user_id);
          }
        }
      }
      // Only remove this user's membership.
      await sb.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
    }
  }

  // 3. Delete the user record (cascades to any remaining memberships).
  await sb.from("users").delete().eq("id", userId);

  // 4. Clear the session cookie so the browser doesn't retain a stale token.
  await destroySession();

  return NextResponse.json({ ok: true, message: "Account and all associated data have been deleted." });
}
