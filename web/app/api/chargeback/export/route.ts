import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { getAdminClient } from "@/lib/supabase/admin";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same demo exemption as app/cost/teams/page.tsx and /api/chargeback/teams —
  // this route had none at all, so exporting the CSV always 403'd for the
  // demo account regardless of DEMO_MODE or isDemoEmail.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  if (!demo && !await orgHasFeature(session.orgId, "chargeback"))
    return NextResponse.json({ error: "Team chargeback requires an Enterprise plan." }, { status: 403 });

  // A non-numeric ?days (e.g. "abc") makes parseInt return NaN, which
  // Math.max/Math.min pass through unchanged — days would stay NaN and the
  // `since` computation below would carry it into an invalid query window.
  // `|| 30` catches it first, same guard as the sibling /api/chargeback route.
  const days = Math.min(90, Math.max(7, parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10) || 30));
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const { data: rows } = await sb
    .from("ad_chargeback")
    .select("day,team_id,runs,tokens,cost_usd,ad_teams(name)")
    .eq("org_id", session.orgId)
    .gte("day", since)
    .order("day", { ascending: false })
    // Unbounded, this was a silent 1000-row prefix from PostgREST — a CSV that
    // a finance team reconciles against an invoice, quietly missing rows with
    // no indication it had been cut. Bounded explicitly instead.
    .limit(50_000);

  const lines: string[] = ["date,team_name,runs,tokens,cost_usd"];
  for (const row of rows ?? [] as Array<{
    day: string;
    team_id: string;
    runs: number;
    tokens: number;
    cost_usd: number;
    ad_teams: { name: string } | null;
  }>) {
    const teamName = row.ad_teams?.name ?? row.team_id;
    lines.push(`${row.day},${JSON.stringify(teamName)},${row.runs},${row.tokens},${Number(row.cost_usd).toFixed(4)}`);
  }

  const csv = lines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="chargeback-${days}d.csv"`,
    },
  });
}
