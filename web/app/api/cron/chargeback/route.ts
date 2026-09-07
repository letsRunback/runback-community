import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { mustRead } from "@/lib/supabase/read";
import { mustWrite } from "@/lib/supabase/write";
import { tokenCostUsd } from "@/lib/chargeback";
import { cronAuthorized } from "@/lib/cronAuth";

/** Row ceiling for aggregate reads. Events-per-run is unbounded even when the
  * run set is not, so reads are capped explicitly rather than relying on
  * PostgREST truncating silently. */
const MAX_ROWS = 50_000;

export const runtime = "nodejs";
export const maxDuration = 300;

// Cron schedule: 0 6 * * * (daily at 6 AM UTC)
//
// This job wrote nothing, ever, until the column names were fixed: it selected
// `agent` and `model_id` from ad_runs, where the columns are `name` and (for the
// model) an ad_events field entirely. PostgREST answered 400, the ignored error
// left `runs` undefined, the `continue` below swallowed it, and ad_chargeback
// stayed empty while the Cost pages rendered a clean "no data yet".
//
// Because the normal window is only 7 days, fixing it recovers nothing on its
// own — pass ?days=90 once after deploying to backfill. The upsert is keyed on
// (org_id, team_id, day), so re-running any window is idempotent.

interface RunRow {
  run_id: string;
  name: string | null;
  team_id: string | null;
  total_tokens: number | null;
  started_at: string;
}

// The shared client carries no generated row types, so payloads infer as `never`.
// Same escape hatch as lib/auth.ts:29 — the safety here comes from the explicit
// row interfaces above and from mustRead/mustWrite, not from the client's types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Default to the daily 7-day re-aggregation; allow a wider one-off backfill.
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const lookbackDays = Math.min(365, Math.max(1, Number.isFinite(daysParam) ? daysParam : 7));

  const sb = db();

  // Find all orgs that have teams
  const teamsData = await mustRead<Array<{ id: string; org_id: string; name: string }>>(
    sb.from("ad_teams").select("id,org_id,name"),
    "chargeback: load teams"
  );

  if (!teamsData?.length) {
    return NextResponse.json({ processed: 0, upserts: 0, lookback_days: lookbackDays });
  }

  // Group teams by org
  const orgTeams = new Map<string, Array<{ id: string; name: string }>>();
  for (const team of teamsData) {
    const arr = orgTeams.get(team.org_id) ?? [];
    arr.push({ id: team.id, name: team.name });
    orgTeams.set(team.org_id, arr);
  }

  // Fetch agent prefix rules for all orgs
  const orgIds = [...orgTeams.keys()];
  const rulesData = await mustRead<Array<{ org_id: string; team_id: string; prefix: string }>>(
    sb.from("ad_team_agent_rules").select("org_id,team_id,prefix").in("org_id", orgIds),
    "chargeback: load agent prefix rules"
  );

  // Build rule lookup: orgId → [{prefix, team_id}] sorted longest-first for specificity
  const orgRules = new Map<string, Array<{ prefix: string; team_id: string }>>();
  for (const rule of rulesData ?? []) {
    const arr = orgRules.get(rule.org_id) ?? [];
    arr.push({ prefix: rule.prefix.toLowerCase(), team_id: rule.team_id });
    orgRules.set(rule.org_id, arr);
  }
  for (const [orgId, rules] of orgRules) {
    rules.sort((a, b) => b.prefix.length - a.prefix.length);
    orgRules.set(orgId, rules);
  }

  let totalUpserts = 0;
  let errors = 0;

  // mustRead/mustWrite deliberately THROW rather than swallow a PostgREST
  // error (see lib/supabase/read.ts/write.ts) — correct in isolation, but
  // without a per-org try/catch here, one org's transient DB hiccup (a
  // timeout, an oversized IN() clause, whatever) threw straight out of this
  // loop and aborted the WHOLE cron invocation: every org after the failing
  // one in iteration order silently got zero chargeback rollup for the day,
  // with nothing in the response indicating which orgs were skipped. Every
  // sibling cron that loops over orgs (billing-reconcile, governance-findings)
  // already guards each iteration this way — this one didn't.
  for (const [orgId] of orgTeams) {
    try {
      const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString();

      // ad_runs holds the agent under `name`. It has no model column at all.
      const runs = await mustRead<RunRow[]>(
        sb
          .from("ad_runs")
          .select("run_id,name,team_id,total_tokens,started_at")
          .eq("org_id", orgId)
          .gte("started_at", since).limit(MAX_ROWS),
        `chargeback: load runs for org ${orgId}`
      );

      if (!runs?.length) continue;

      // The model lives on the LLM spans, so cost needs a second query joined on
      // run_id. Without it every run priced at DEFAULT_BLENDED_USD_PER_M and the
      // per-team costs were uniform fiction. Same shape as lib/modelDiff.ts.
      const modelEvents = await mustRead<Array<{ run_id: string; model_id: string | null }>>(
        sb
          .from("ad_events")
          .select("run_id,model_id")
          .eq("type", "llm")
          .not("model_id", "is", null)
          .eq("org_id", orgId).in("run_id", runs.map((r) => r.run_id)).limit(MAX_ROWS),
        `chargeback: load run models for org ${orgId}`
      );
      // A run can span several models; bill it at the first one observed, which
      // matches how the model-attribution page groups runs.
      const modelByRun = new Map<string, string>();
      for (const e of modelEvents ?? []) {
        if (e.model_id && !modelByRun.has(e.run_id)) modelByRun.set(e.run_id, e.model_id);
      }

      const rules = orgRules.get(orgId) ?? [];

      // Accumulate: {team_id -> {day -> {runs, tokens, cost}}}
      const acc = new Map<string, Map<string, { runs: number; tokens: number; cost: number }>>();

      for (const run of runs) {
        let teamId = run.team_id;

        // If no team_id, try to match via prefix rules
        if (!teamId && run.name) {
          const agentLower = run.name.toLowerCase();
          for (const rule of rules) {
            if (agentLower.startsWith(rule.prefix)) {
              teamId = rule.team_id;
              break;
            }
          }
        }

        if (!teamId) continue;

        const day = run.started_at.slice(0, 10); // YYYY-MM-DD
        const tokens = run.total_tokens ?? 0;
        const cost = tokenCostUsd(tokens, modelByRun.get(run.run_id) ?? null);

        const teamDays = acc.get(teamId) ?? new Map<string, { runs: number; tokens: number; cost: number }>();
        const dayStats = teamDays.get(day) ?? { runs: 0, tokens: 0, cost: 0 };
        dayStats.runs++;
        dayStats.tokens += tokens;
        dayStats.cost += cost;
        teamDays.set(day, dayStats);
        acc.set(teamId, teamDays);
      }

      // Upsert into ad_chargeback
      const upsertRows: Array<{
        org_id: string;
        team_id: string;
        day: string;
        runs: number;
        tokens: number;
        cost_usd: number;
      }> = [];

      for (const [teamId, dayMap] of acc) {
        for (const [day, stats] of dayMap) {
          upsertRows.push({
            org_id: orgId,
            team_id: teamId,
            day,
            runs: stats.runs,
            tokens: stats.tokens,
            cost_usd: stats.cost,
          });
        }
      }

      if (upsertRows.length > 0) {
        // Throw rather than silently under-report: a rollup that did not land is
        // a cost figure nobody will ever see is missing. Caught by the try/catch
        // above, which logs and moves on to the next org instead of aborting.
        await mustWrite(
          sb.from("ad_chargeback").upsert(upsertRows, { onConflict: "org_id,team_id,day" }),
          `chargeback: upsert rollup for org ${orgId}`
        );
        totalUpserts += upsertRows.length;
      }
    } catch (e) {
      errors++;
      console.error(`[cron/chargeback] org ${orgId} failed, continuing with remaining orgs:`, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({
    processed: orgIds.length,
    upserts: totalUpserts,
    lookback_days: lookbackDays,
    errors,
  });
}
