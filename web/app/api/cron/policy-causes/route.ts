import { NextRequest, NextResponse } from "next/server";
import { readAll } from "@/lib/supabase/read";
import { getAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const now = new Date();
  // Look back 7 days for idempotent re-aggregation
  const since = new Date(now.getTime() - 7 * 86400_000);

  // Paged. Read unbounded, this returned a capped prefix, so the policy-cause
  // heat-map silently omitted whatever fell past it — across every org at once,
  // since this cron aggregates for all of them.
  let events: { run_id: string; ts_start: string; data: unknown }[];
  try {
    events = await readAll<{ run_id: string; ts_start: string; data: unknown }>(
      (from, to) => sb
        .from("ad_events")
        .select("run_id, ts_start, data")
        .eq("type", "tool")
        .eq("policy_blocked", true)
        .gte("ts_start", since.toISOString())
        .range(from, to),
      "policy-causes: blocked tool events"
    );
  } catch (e) {
    console.error("[cron/policy-causes] events error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!events.length) {
    return NextResponse.json({ upserted: 0, days_covered: 7 });
  }

  // Collect all run_ids to join with ad_runs
  const runIds = [...new Set(events.map((e: { run_id: string }) => e.run_id))];

  // Chunked instead of runIds.slice(0, 1000): every event past the first
  // thousand runs lost its agent and org attribution and was dropped from the
  // aggregate entirely.
  const runs: { run_id: string; name: string; org_id: string }[] = [];
  try {
    const CHUNK = 500; // keeps the ?in=(…) URL well inside limits
    for (let i = 0; i < runIds.length; i += CHUNK) {
      const part = runIds.slice(i, i + CHUNK);
      runs.push(...await readAll<{ run_id: string; name: string; org_id: string }>(
        (from, to) => sb.from("ad_runs").select("run_id, name, org_id").in("run_id", part).range(from, to),
        "policy-causes: runs for blocked events"
      ));
    }
  } catch (e) {
    console.error("[cron/policy-causes] runs error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

   
  const runMap = new Map<string, { name: string; org_id: string }>();
  for (const r of runs) runMap.set(r.run_id, { name: r.name, org_id: r.org_id });

  // Aggregate block_count by org_id + day + policy_name + agent
  const blockAgg = new Map<string, { org_id: string; day: string; policy_name: string; agent: string; block_count: number }>();

  for (const ev of events) {
    const run = runMap.get(ev.run_id);
    if (!run) continue;
    const policyName = (ev.data as { policy_block?: { rule?: string } })?.policy_block?.rule;
    if (!policyName) continue;
    const day = (ev.ts_start as string).slice(0, 10); // YYYY-MM-DD
    const key = `${run.org_id}|${day}|${policyName}|${run.name}`;
    const existing = blockAgg.get(key) ?? { org_id: run.org_id, day, policy_name: policyName, agent: run.name, block_count: 0 };
    existing.block_count++;
    blockAgg.set(key, existing);
  }

  // Fetch run counts per org/day/agent from ad_run_rollups in one batch query
  const uniqueOrgs = [...new Set([...blockAgg.values()].map(v => v.org_id))];
  const uniqueDays = [...new Set([...blockAgg.values()].map(v => v.day))];

  const { data: rollupRows } = await sb
    .from("ad_run_rollups")
    .select("org_id,day,agent,runs")
    .in("org_id", uniqueOrgs)
    .in("day", uniqueDays)
    .gte("day", since.toISOString().slice(0, 10));

  const runCountMap = new Map<string, number>();
  for (const r of rollupRows ?? []) {
    runCountMap.set(`${r.org_id}|${r.day}|${r.agent}`, r.runs ?? 0);
  }

  // Build upsert rows
  const rows = [...blockAgg.values()].map((v) => ({
    org_id: v.org_id,
    day: v.day,
    policy_name: v.policy_name,
    agent: v.agent,
    block_count: v.block_count,
    run_count: runCountMap.get(`${v.org_id}|${v.day}|${v.agent}`) ?? 0,
  }));

  if (!rows.length) return NextResponse.json({ upserted: 0 });

  const { error: upsertErr } = await sb
    .from("ad_policy_causes")
    .upsert(rows, { onConflict: "org_id,day,policy_name,agent" });

  if (upsertErr) {
    console.error("[cron/policy-causes] upsert error:", upsertErr);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, days_covered: 7 });
}
