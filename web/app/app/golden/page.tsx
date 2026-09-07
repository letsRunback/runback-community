import { Fragment } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { can } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import { getGoldenReport, suggestRule, type GoldenReport } from "@/lib/golden";
import { listRuns } from "@/lib/runs";
import { getAdminClient } from "@/lib/supabase/admin";
import { BarChartMini } from "@/components/app/charts";
import GoldenActions from "./GoldenActions";
import RunSuiteButton from "./RunSuiteButton";
import SuggestedRulePanel from "./SuggestedRulePanel";
import FeatureGate from "../FeatureGate";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

// ── Demo data ─────────────────────────────────────────────────────────────────

const DEMO_WEEKS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 4, 4)); // 2026-05-04 (Sunday)
  d.setUTCDate(d.getUTCDate() + i * 7);
  return d.toISOString().slice(0, 10);
});

// run_id is filled in from the org's real seeded runs at request time (see
// buildDemoReport) — these placeholders must never ship as literal hrefs,
// since a fictional run_id 404s the moment someone clicks the row.
const DEMO_ENTRY_TEMPLATES = [
  { id: "g1", reason: "policy_block" as const, signature: "sig1", detail: "send_email blocked — no-pii", baseline_digest: null, status: "active" as const, created_at: new Date(Date.now() - 1 * 86400_000).toISOString(), last_run_at: null, last_result: null },
  { id: "g2", reason: "error" as const, signature: "sig2", detail: "research-agent — fetch threw NetworkError", baseline_digest: null, status: "approved" as const, created_at: new Date(Date.now() - 2 * 86400_000).toISOString(), last_run_at: new Date(Date.now() - 1 * 86400_000).toISOString(), last_result: "reproduced" as const, approved_by: "alice@acme.com", streak_runs: 9, streak_policy_revisions: 2 },
  { id: "g3", reason: "policy_block" as const, signature: "sig3", detail: "write_file blocked — path-traversal", baseline_digest: null, status: "active" as const, created_at: new Date(Date.now() - 3 * 86400_000).toISOString(), last_run_at: null, last_result: null },
  { id: "g4", reason: "error" as const, signature: "sig4", detail: "billing-agent failed — RateLimitError", baseline_digest: null, status: "dismissed" as const, created_at: new Date(Date.now() - 5 * 86400_000).toISOString(), last_run_at: new Date(Date.now() - 2 * 86400_000).toISOString(), last_result: "diverged" as const },
  { id: "g5", reason: "policy_block" as const, signature: "sig5", detail: "exec_shell blocked — deny-list", baseline_digest: null, status: "active" as const, created_at: new Date(Date.now() - 6 * 86400_000).toISOString(), last_run_at: null, last_result: null },
  { id: "g6", reason: "error" as const, signature: "sig6", detail: "onboarding-agent — db threw TimeoutError", baseline_digest: null, status: "approved" as const, created_at: new Date(Date.now() - 8 * 86400_000).toISOString(), last_run_at: new Date(Date.now() - 3 * 86400_000).toISOString(), last_result: "reproduced" as const, approved_by: "bob@acme.com", streak_runs: 23, streak_policy_revisions: 4 },
  { id: "g7", reason: "policy_block" as const, signature: "sig7", detail: "read_secret blocked — vault-deny", baseline_digest: null, status: "active" as const, created_at: new Date(Date.now() - 10 * 86400_000).toISOString(), last_run_at: null, last_result: null },
  { id: "g8", reason: "error" as const, signature: "sig8", detail: "support-agent — parse_invoice threw JSONParseError", tool_name: "parse_invoice", baseline_digest: null, status: "active" as const, created_at: new Date(Date.now() - 12 * 86400_000).toISOString(), last_run_at: new Date(Date.now() - 5 * 86400_000).toISOString(), last_result: "diverged" as const },
];

/** Builds demo golden-corpus data whose run_id links point at the org's actual
 * seeded runs (cycling if there are fewer runs than entries), so every row is
 * a live, clickable link instead of a fictional ID that 404s.
 *
 * The Approve/Dismiss buttons hit the real /api/golden/approve route, which
 * does `UPDATE ad_golden ... WHERE org_id = ? AND run_id = ?` — but these
 * template entries were never actual ad_golden rows, so that update matched
 * zero rows, returned no error, and the API replied {ok:true} while
 * persisting nothing. The click looked like it worked (client-side optimistic
 * state) and then silently reverted on the next page load. Fixed by
 * upserting the templates into ad_golden once (idempotent on org_id+
 * signature) and reading live status back from there, so an approve/dismiss
 * has a real row to land on and survives a reload like it does for a real org. */
async function buildDemoReport(orgId: string, persist: boolean): Promise<GoldenReport> {
  const runs = await listRuns(20, orgId).catch(() => []);
  if (!runs.length) return { total_active: 0, enrolled_this_week: 0, replay_divergence_rate: 0, weekly_enrollments: DEMO_WEEKS.map((week) => ({ week, count: 0 })), entries: [] };

  // Same rule as getGoldenReport(): only a still-active error-reason entry
  // gets a suggestion (an approved/dismissed one already had its human call
  // made; policy_block is already covered). Mirrored here so the demo
  // actually demonstrates the suggested-rule panel instead of the fixture
  // predating that feature and never growing one.
  const templated = DEMO_ENTRY_TEMPLATES.map((t, i) => ({
    ...t,
    run_id: runs[i % runs.length].run_id,
    suggestion:
      t.status === "active" && t.reason === "error"
        ? suggestRule({ reason: "error", signature: t.signature, detail: t.detail ?? "", tool_name: "tool_name" in t ? t.tool_name : undefined })
        : null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  // Persist ONLY in demo mode.
  //
  // Writing the fixtures makes the demo's Approve/Dismiss buttons work (see
  // above). But this function also renders the locked preview for a
  // non-entitled real org — and there, persisting meant that merely VISITING
  // this page wrote eight fabricated entries into that tenant's own ad_golden
  // table, complete with invented failures and invented approvers
  // (alice@acme.com, bob@acme.com). Upgrade later and getGoldenReport() reads
  // them back as genuine mined incidents, indistinguishable from real ones.
  //
  // The golden corpus is meant to be real production failures promoted into
  // regression tests. A release gate standing on invented entries is worse than
  // no gate. The preview is blurred and pointer-events:none anyway, so nothing
  // in it can be clicked and nothing needs a row to land on.
  if (persist) {
    try {
      await sb.from("ad_golden").upsert(
        templated.map((t) => ({
        org_id: orgId, run_id: t.run_id, reason: t.reason, signature: t.signature,
        detail: t.detail, baseline_digest: t.baseline_digest, status: t.status,
      })),
        { onConflict: "org_id,signature", ignoreDuplicates: true },
      );
    } catch { /* table may not exist yet — fall back to the static template below */ }
  }

  const { data: live } = await sb
    .from("ad_golden")
    .select("id,run_id,signature,status,last_run_at,last_result,approved_by,approved_at")
    .eq("org_id", orgId)
    .in("run_id", templated.map((t) => t.run_id))
    .then((r: { data: unknown }) => r, () => ({ data: null }));
  // Joined on signature, not run_id: the demo cycles 8 template entries over
  // as few as 3 real seeded runs (i % runs.length), so multiple entries can
  // share a run_id. signature is the actual unique key (matches the
  // org_id+signature upsert above), so this avoids one entry's row
  // clobbering another's in the lookup. The real DB id is pulled through too
  // (replacing the template's placeholder "g1".."g8") so GoldenActions can
  // send approveRun/dismissRun the entry's own id — see those functions for
  // why keying on run_id there would let one entry's approve flip a sibling
  // that happens to share its run_id.
  const liveBySignature = new Map((live ?? []).map((r: { signature: string }) => [r.signature, r]));

  const entries = templated.map((t) => {
    const l = liveBySignature.get(t.signature) as { id: string; status: string; last_run_at: string | null; last_result: string | null; approved_by?: string; approved_at?: string } | undefined;
    return l ? { ...t, id: l.id, status: l.status as typeof t.status, last_run_at: l.last_run_at, last_result: l.last_result as typeof t.last_result, approved_by: l.approved_by } : t;
  });

  return {
    total_active: entries.length,
    enrolled_this_week: Math.min(3, entries.length),
    replay_divergence_rate: entries.length ? 0.14 : 0,
    weekly_enrollments: DEMO_WEEKS.map((week, i) => ({
      week,
      count: [0, 1, 0, 2, 1, 3, 2, 4, 3, 5, 4, 3][i] ?? 0,
    })),
    entries,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function GoldenPage() {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session?.email);
  // Trial-aware effective plan (session.orgPlan), not the raw orgs.plan column —
  // that column stays "free" for the whole trial, which would deny a trialing org
  // the very features its trial grants.
  const allowed = demo || can(session.orgPlan, "quality");
  const deepReplayAllowed = demo || can(session.orgPlan, "deep_replay");

  // Not entitled → reuse the same illustrative fixture already used for demo
  // mode, so the glimpse under the gate is real-shaped instead of empty.
  let report: GoldenReport;
  if (allowed) {
    report = demo ? await buildDemoReport(session.orgId, true) : await getGoldenReport(session.orgId);
  } else {
    // Locked preview for a non-entitled org — display only, never persisted.
    report = await buildDemoReport(session.orgId, false);
  }

  // Every path that renders fixtures rather than the org's own data.
  const sample = demo || !allowed;

  const BAR_HEIGHT = 60; // px

  const body = (
    <>
      {/* KPI row */}
      {/* Say so when the numbers below are illustrative. The divergence rate in
          the sample set is a fixed 14%, not a measurement — presenting that in a
          tile identical to a real one invites a reader to quote it. */}
      {sample && (
        <p className="golden-sample-note mono">
          Sample data — illustrative figures, not measurements from your workspace.
        </p>
      )}
      <div className="golden-kpi-grid" data-sample={sample || undefined}>
        {[
          { label: "Bugs that can never ship again", value: String(report.total_active) },
          { label: "New this week", value: String(report.enrolled_this_week) },
          {
            label: "Silently regressing right now",
            value:
              report.replay_divergence_rate === 0
                ? "—"
                : `${(report.replay_divergence_rate * 100).toFixed(0)}%`,
          },
        ].map(({ label, value }) => (
          <div key={label} className="golden-kpi-card">
            <div className="golden-kpi-value mono">{value}</div>
            <div className="golden-kpi-label">{label}</div>
          </div>
        ))}
      </div>

      {/* 12-week bar chart */}
      <div className="golden-sparkline">
        <div className="golden-sparkline-title">
          Weekly enrollments — last 12 weeks
        </div>
        <BarChartMini
          data={report.weekly_enrollments.map((w) => ({ key: w.week, value: w.count, label: fmtWeek(w.week) }))}
          color="var(--brand)"
          height={BAR_HEIGHT}
        />
      </div>

      {/* Table or empty state */}
      {report.entries.length === 0 ? (
        <div className="golden-empty">
          <p className="golden-empty-p">
            No incidents enrolled yet. Run agents — first policy block or error enrolls automatically.
          </p>
          <Link href="/docs" className="mono golden-empty-link">
            View docs →
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="appc-table">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Agent / Run ID</th>
                <th>Enrolled</th>
                <th>Stability</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td>
                      <span
                        className={`mono golden-reason ${e.reason === "policy_block" ? "golden-reason--policy" : "golden-reason--error"}`}
                      >
                        {e.reason === "policy_block" ? "policy" : "error"}
                      </span>
                    </td>
                    <td>
                      <div>
                        <a
                          href={`/app/runs/${e.run_id}`}
                          className="mono golden-run-link"
                        >
                          {e.run_id.slice(0, 14)}…
                        </a>
                        {e.detail && (
                          <div className="golden-detail" title={e.detail}>
                            {e.detail}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="mono golden-date">
                      {fmtDate(e.created_at)}
                    </td>
                    <td className="mono golden-streak">
                      {e.streak_runs ? (
                        <span title={`Reproduced clean on the last ${e.streak_runs} run${e.streak_runs === 1 ? "" : "s"}${e.streak_policy_revisions ? `, across ${e.streak_policy_revisions} policy revision${e.streak_policy_revisions === 1 ? "" : "s"}` : ""} — history only Runback has, not something an export of this row can carry.`}>
                          ✓ {e.streak_runs} run{e.streak_runs === 1 ? "" : "s"}
                          {e.streak_policy_revisions ? <span className="golden-streak-rev"> · {e.streak_policy_revisions} rev{e.streak_policy_revisions === 1 ? "" : "s"}</span> : null}
                        </span>
                      ) : (
                        <span className="appc-dim">—</span>
                      )}
                    </td>
                    <GoldenActions id={e.id} status={e.status} needsReReview={e.needs_re_review} />
                  </tr>
                  {e.suggestion && (
                    <tr className="golden-suggest-row">
                      <td colSpan={6}>
                        <SuggestedRulePanel note={e.suggestion.note} ruleJson={JSON.stringify(e.suggestion.rule, null, 2)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <div className="appc">
      {/* Header */}
      <div className="appc-head">
        <h1 className="appc-h1">Golden corpus</h1>
        <p className="appc-sub">
          Every policy block and runtime error becomes a permanent test — the same bug can never silently ship twice.
        </p>
      </div>

      {allowed && !sample && <RunSuiteButton deepReplayAllowed={deepReplayAllowed} />}
      <FeatureGate
        allowed={allowed}
        badge={planBadgeText("quality")}
        title="Golden corpus is a Growth feature"
        lead="Every policy block and runtime error becomes a permanent, deduped regression test. Re-run the corpus on any candidate model before release — yours grows with usage while competitors start from zero."
        ctaHref={UPGRADE_HREF}
        ctaLabel="Upgrade →"
      >
        {body}
      </FeatureGate>
    </div>
  );
}
