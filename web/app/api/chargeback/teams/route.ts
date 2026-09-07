import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import {
  getTeams,
  createTeam,
  updateTeamBudget,
  deleteTeam,
  getAgentRules,
  upsertAgentRule,
  deleteAgentRule,
} from "@/lib/chargeback";

export const dynamic = "force-dynamic";

async function getAuthorizedSession(): Promise<{ session: NonNullable<Awaited<ReturnType<typeof getSession>>>; deny: null } | { session: null; deny: NextResponse }> {
  const session = await getSession();
  if (!session) return { session: null, deny: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  // CostTeamsClient renders unconditionally in demo mode (see app/cost/teams/page.tsx,
  // which exempts DEMO_MODE OR a per-email demo account) so this must exempt
  // the same two cases — checking only the global DEMO_MODE flag here left a
  // per-email demo login (isDemoEmail true, DEMO_MODE env flag off, which is
  // the normal case in production) 403ing on every action despite the page
  // rendering the unlocked form for it.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  if (!demo && !await orgHasFeature(session.orgId, "chargeback")) return { session: null, deny: NextResponse.json({ error: "Enterprise feature." }, { status: 403 }) };
  return { session, deny: null };
}

export async function GET(req: NextRequest) {
  const { session, deny } = await getAuthorizedSession();
  if (deny) return deny;

  const rules = req.nextUrl.searchParams.get("rules");
  if (rules === "1") {
    const agentRules = await getAgentRules(session.orgId);
    return NextResponse.json(agentRules);
  }

  const teams = await getTeams(session.orgId);
  return NextResponse.json(teams);
}

export async function POST(req: NextRequest) {
  const { session, deny } = await getAuthorizedSession();
  if (deny) return deny;
  if (session.role === "viewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await req.json();

  if (body.prefix !== undefined && body.team_id !== undefined) {
    await upsertAgentRule(session.orgId, body.team_id as string, body.prefix as string);
    return NextResponse.json({ ok: true });
  }

  // Budget edit — CostTeamsClient's saveBudget() posts { team_id, budget_usd }
  // with no name, since it's updating an existing team, not creating one.
  if (body.team_id !== undefined && body.name === undefined) {
    await updateTeamBudget(session.orgId, body.team_id as string, body.budget_usd ?? null);
    return NextResponse.json({ ok: true });
  }

  const { name, budget_usd, color } = body as { name: string; budget_usd?: number | null; color?: string | null };
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const team = await createTeam(session.orgId, name, budget_usd ?? null, color ?? null);
  return NextResponse.json(team, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { session, deny } = await getAuthorizedSession();
  if (deny) return deny;
  if (session.role === "viewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await req.json();

  if (body.rule_id !== undefined) {
    await deleteAgentRule(session.orgId, body.rule_id as string);
    return NextResponse.json({ ok: true });
  }

  if (body.team_id !== undefined) {
    await deleteTeam(session.orgId, body.team_id as string);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "team_id or rule_id required" }, { status: 400 });
}
