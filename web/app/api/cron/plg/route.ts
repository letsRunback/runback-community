import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { mustRead } from "@/lib/supabase/read";
import { firePlgEvent } from "@/lib/plg";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

interface OrgRow {
  id: string;
  created_at: string;
  trial_ends_at: string | null;
  plan: string;
}

// The shared client carries no generated row types. Same escape hatch as
// lib/auth.ts:29; the safety here is the explicit row shapes plus mustRead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = db();
  const now = new Date();

  // Orgs on free plan that signed up 3+ days ago.
  const orgs = await mustRead<OrgRow[]>(
    sb
      .from("orgs")
      .select("id, created_at, trial_ends_at, plan")
      .eq("plan", "free")
      .lte("created_at", new Date(now.getTime() - 3 * 86400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(500),
    "plg: load free-plan orgs"
  );

  if (!orgs?.length) return NextResponse.json({ fired: 0 });

  const orgIds = orgs.map((o) => o.id);

  // All plg_events already fired for these orgs.
  const fired = await mustRead<Array<{ org_id: string; event: string }>>(
    sb.from("plg_events").select("org_id, event").in("org_id", orgIds),
    "plg: load already-fired events"
  );

  const firedSet = new Set<string>((fired ?? []).map((r) => `${r.org_id}:${r.event}`));
  const hasFired = (orgId: string, event: string) => firedSet.has(`${orgId}:${event}`);

  // Run counts for the 100-run milestone.
  //
  // This asked `.from("runs")` — no such table; it is `ad_runs`. It also selected
  // a `count` column that exists on nothing. The query 400'd, the ignored error
  // left runCounts null, every org scored 0 runs, and the milestone below has
  // therefore never fired for anyone. A head+count per org is exact and cheap;
  // selecting org_id for every run would drag the whole fleet's rows over the
  // wire just to length them.
  const countByOrg = new Map<string, number>();
  for (const orgId of orgIds) {
    const { count, error } = await sb
      .from("ad_runs")
      .select("run_id", { count: "exact", head: true })
      .eq("org_id", orgId);
    if (error) {
      console.error(`[plg] run count failed for org ${orgId}:`, error.message);
      continue;
    }
    countByOrg.set(orgId, count ?? 0);
  }

  // Team member counts — orgs with >1 member have invited someone.
  const memberCounts = await mustRead<Array<{ org_id: string }>>(
    sb.from("memberships").select("org_id").in("org_id", orgIds),
    "plg: load membership counts"
  );
  const membersByOrg = new Map<string, number>();
  for (const m of memberCounts ?? []) {
    membersByOrg.set(m.org_id, (membersByOrg.get(m.org_id) ?? 0) + 1);
  }

  let count = 0;

  for (const org of orgs) {
    const age = now.getTime() - new Date(org.created_at).getTime();
    const daysOld = age / 86400_000;
    const trialEndsAt = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
    const daysLeft = trialEndsAt ? (trialEndsAt.getTime() - now.getTime()) / 86400_000 : 99;
    const runCount = countByOrg.get(org.id) ?? 0;
    const memberCount = membersByOrg.get(org.id) ?? 0;

    // Day 3: captured runs but no policy yet.
    if (daysOld >= 3 && !hasFired(org.id, "trial_nudge_day3") && hasFired(org.id, "first_run_captured") && !hasFired(org.id, "first_policy_created")) {
      await firePlgEvent(org.id, "trial_nudge_day3").catch(() => {});
      count++;
    }

    // Day 5: has policy but no eval/CI gate yet.
    if (daysOld >= 5 && !hasFired(org.id, "trial_nudge_day5") && hasFired(org.id, "first_policy_created") && !hasFired(org.id, "first_eval_run")) {
      await firePlgEvent(org.id, "trial_nudge_day5").catch(() => {});
      count++;
    }

    // Day 7 (trial ends in ≤7 days): still free, hasn't had a day-7 nudge.
    if (daysLeft <= 7 && daysLeft >= 0 && !hasFired(org.id, "trial_nudge_day7")) {
      await firePlgEvent(org.id, "trial_nudge_day7").catch(() => {});
      count++;
    }

    // Team invite — org has more than 1 member and we haven't fired this yet.
    if (memberCount > 1 && !hasFired(org.id, "first_team_member_invited")) {
      await firePlgEvent(org.id, "first_team_member_invited", { members: memberCount }).catch(() => {});
      count++;
    }

    // 100-run milestone.
    if (runCount >= 100 && !hasFired(org.id, "milestone_100_runs")) {
      await firePlgEvent(org.id, "milestone_100_runs", { count: runCount }).catch(() => {});
      count++;
    }

    // Week 3 stalled — 21+ days on free, has runs, never upgraded.
    if (daysOld >= 21 && hasFired(org.id, "first_run_captured") && !hasFired(org.id, "week3_no_upgrade")) {
      await firePlgEvent(org.id, "week3_no_upgrade").catch(() => {});
      count++;
    }
  }

  return NextResponse.json({ fired: count });
}
