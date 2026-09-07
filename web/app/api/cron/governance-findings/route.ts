import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyLedger } from "@/lib/ledger";
import { agentCoverage } from "@/lib/coverage";
import { raiseFinding } from "@/lib/workflow";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Detect governance findings and raise them in the customer's workflow system.
 *
 * Runs hourly. Only orgs with a configured sink are examined — verifying a
 * ledger is not free, and doing it for orgs that have asked for nothing would
 * be work nobody sees.
 *
 * Three findings are raised by default because all three are rare and severe:
 *
 *   ledger_tamper  the audit trail no longer verifies. If this is real it is
 *                  the single most serious thing the product can report.
 *   critical_gap   a critical or high-criticality agent is not reporting —
 *                  either unmonitored, or capture stopped unnoticed. Critical/
 *                  high agents use a much shorter staleness window (24h) than
 *                  standard ones (14d) — see agent_coverage's p_stale_hours_critical
 *                  — because two weeks is a very late warning for a critical
 *                  agent that stopped reporting.
 *   shadow_agent   an agent is reporting runs but was never declared in the
 *                  inventory — the reverse gap: not "declared but silent," but
 *                  "running in production and nobody put it on the register."
 *
 * Routine policy blocks are opt-in and thresholded; raising one per block would
 * bury the queue and get the integration switched off.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: sinks, error } = await sb
    .from("ad_workflow_sinks").select("org_id").eq("enabled", true);
  if (error) {
    console.error("[cron/governance-findings] sinks query failed:", error.message);
    return NextResponse.json({ ok: false, error: "db error" }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
  let checked = 0, raised = 0;
  const failures: string[] = [];

  for (const { org_id: orgId } of (sinks ?? []) as { org_id: string }[]) {
    checked++;
    try {
      const v = await verifyLedger(orgId, true).catch(() => null);
      // intact === false only. null means "could not verify", and paging
      // someone for an unreadable database as though it were evidence
      // tampering is exactly the false alarm the ledger work removed.
      if (v && v.intact === false && v.brokenAt) {
        const r = await raiseFinding(orgId, {
          kind: "ledger_tamper",
          dedupeKey: `ledger_tamper:${v.brokenAt.seq}:${v.brokenAt.run_id}`,
          title: `Runback: audit ledger verification failed at entry ${v.brokenAt.seq}`,
          detail: `${v.brokenAt.reason}\n\nRun: ${v.brokenAt.run_id}\nEntries: ${v.count}`,
          urgency: "critical",
          link: `${base}/app/ledger`,
        });
        if (r.raised) raised++;
      }

      const cov = await agentCoverage(orgId).catch(() => null);
      for (const gap of cov?.criticalGaps ?? []) {
        const r = await raiseFinding(orgId, {
          kind: "critical_gap",
          // Keyed on the agent and its state, so an agent moving from stale to
          // uninstrumented is a new finding rather than a silent update.
          dedupeKey: `critical_gap:${gap.name}:${gap.status}`,
          title: `Runback: ${gap.criticality} agent "${gap.name}" is not under governance`,
          detail:
            gap.status === "uninstrumented"
              ? `${gap.name} is declared in the agent inventory but has never reported a run. It is running without observation, or was never instrumented.`
              : `${gap.name} reported previously but has gone silent. Capture may have broken, or it was retired without being removed from the inventory.`,
          urgency: gap.criticality === "critical" ? "critical" : "high",
          link: `${base}/app/coverage`,
        });
        if (r.raised) raised++;
      }

      for (const shadow of cov?.undeclaredRows ?? []) {
        const r = await raiseFinding(orgId, {
          kind: "shadow_agent",
          // Keyed on the name alone (no status component, unlike critical_gap) —
          // "undeclared" isn't a state an agent moves through, it's just true
          // until someone declares or retires it, so one open finding per name
          // is the right shape rather than a new one each sweep.
          dedupeKey: `shadow_agent:${shadow.name}`,
          title: `Runback: agent "${shadow.name}" is reporting but not in your governed inventory`,
          detail: `${shadow.name} has produced ${shadow.runs} run(s), most recently ${shadow.last_seen ?? "unknown"}, but nobody has declared it in the agent registry. Either register it with an owner and criticality, or find out why it's running unregistered.`,
          urgency: "high",
          link: `${base}/app/coverage`,
        });
        if (r.raised) raised++;
      }
    } catch (e) {
      failures.push(`${orgId}: ${(e as Error).message}`);
    }
  }

  if (failures.length) console.error("[governance-findings] failures:", failures.join("; "));
  return NextResponse.json({ ok: true, orgs_checked: checked, raised, failed: failures.length });
}
