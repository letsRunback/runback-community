import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { generateComplianceReport, illustrativeComplianceReport, type ComplianceReport } from "@/lib/compliance";
import { planBadgeText } from "@/lib/plans";
import GateOverlay from "../GateOverlay";
import SampleDataEmpty from "../SampleDataEmpty";
import { countRuns } from "@/lib/runs";
import EditionLink from "@/components/EditionLink";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtN = (n: number) => n.toLocaleString();

const WINDOWS = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 180 days", days: 180 },
  { label: "Last 365 days", days: 365 },
  { label: "Last 2 years", days: 730 },
  { label: "Last 3 years", days: 1095 },
];

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession();
  const { days: daysParam } = await searchParams;
  const demo = DEMO_MODE || isDemoEmail(session.email);
  const allowed = demo || (await orgHasFeature(session.orgId, "compliance"));

  const windowDays = Math.min(1095, Math.max(1, parseInt(daysParam ?? "30") || 30));
  // One clock read anchors both ends of the window, so `today` and the window
  // start can never straddle a midnight boundary and report a period one day
  // longer than requested. react-hooks/purity flags clock reads during render;
  // that rule models client components, and this is a request-scoped async
  // Server Component where reading the clock is the entire point.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const thirtyAgo = new Date(now - (windowDays - 1) * 86400_000).toISOString().slice(0, 10);

  let report: ComplianceReport | null = null;
  if (!allowed || demo) {
    // Not entitled, OR the showcase demo account → an illustrative fixture,
    // never this org's real data. The overlay below only blurs client-side;
    // passing the real report as its children would still ship the real
    // numbers in the page source. `demo` unlocks the page (no paywall for the
    // public demo, same as golden/benchmark) but must still render the fixture,
    // not the demo org's own seeded numbers.
    report = illustrativeComplianceReport(thirtyAgo, today, new Date(now).toISOString());
  } else {
    try {
      report = await generateComplianceReport(session.orgId, thirtyAgo, today, demo);
    } catch { /* ignore */ }
  }

  if (!report) {
    return (
      <div className="appc">
        <div className="appc-head">
          <h1 className="appc-h1">Compliance artifacts</h1>
          <p className="appc-sub">Audit-ready evidence for every AI oversight obligation.</p>
        </div>
        <p className="empty">Could not generate report — database may be unreachable.</p>
      </div>
    );
  }

  // A workspace with no captured runs renders every KPI as 0 and every
  // enforcement table as empty — a report that looks like a compliance failure
  // rather than an empty workspace.
  //
  // Deliberately NOT keyed on report.runs.total: that is scoped to the selected
  // period, so an org whose runs all fall outside the window would hit this
  // branch — and a ledger integrity FAILURE would be replaced by a friendly
  // "capture some runs" card. Keyed on the all-time run count instead, and only
  // when the ledger is genuinely empty too, so a tamper alert can never be
  // suppressed by a date filter.
  const allTimeRuns = demo ? -1 : await countRuns(session.orgId);
  if (allowed && !demo && allTimeRuns === 0 && report.ledger.entries === 0) {
    return (
      <div className="appc">
        <div className="appc-head">
          <h1 className="appc-h1">Compliance artifacts</h1>
          <p className="appc-sub">Audit-ready evidence for every AI oversight obligation.</p>
        </div>
        <SampleDataEmpty
          badge="Compliance · audit evidence"
          title="The report is built from your runs — capture some first."
          lead="This page assembles a signed, period-scoped compliance artifact: run counts, policy enforcements, redactions applied and the ledger integrity check. With nothing captured it would report zeros across the board, which is not the same as being non-compliant."
          points={[
            "Every figure traces back to a specific captured run",
            "Ledger integrity verified against the hash chain, not asserted",
            "Exports as structured JSON for an auditor",
          ]}
          foot="Send your first run to start the evidence trail."
        />
      </div>
    );
  }

  const downloadUrl = `/api/compliance/report?start=${thirtyAgo}&end=${today}`;

  const body = (
    <>
      <div className="appc-head comp-head-row">
        <div>
          <h1 className="appc-h1">Compliance artifacts</h1>
          <p className="appc-sub">
            {report.period_start} — {report.period_end} · generated {new Date(report.generated_at).toLocaleString()}
          </p>
          <div className="comp-window-tabs">
            {WINDOWS.map((w) => (
              <a
                key={w.days}
                href={`/app/compliance?days=${w.days}`}
                className={`comp-window-tab mono${windowDays === w.days ? " comp-window-tab-active" : ""}`}
              >
                {w.label}
              </a>
            ))}
          </div>
        </div>
        <EditionLink href="/app/regulatory" className="btn-line comp-framework-link">Framework mappings →</EditionLink>
      </div>

      <div className="comp-download-row">
        <a className="btn-fill" href={downloadUrl} download={`runback-compliance-${thirtyAgo}-${today}.json`}>
          ⤓ Download report (JSON)
        </a>
      </div>

      {/* Run summary */}
      <div className="kpi-row comp-kpi-row-mb">
        <div className="kpi">
          <div className="kpi-k">Total runs</div>
          <div className="kpi-v">{fmtN(report.runs.total)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Success</div>
          <div className="kpi-v">{fmtN(report.runs.success)}</div>
        </div>
        <div className="kpi" data-tone={report.runs.errorRate > 0.1 ? "rose" : undefined}>
          <div className="kpi-k">Errors</div>
          <div className="kpi-v">{fmtN(report.runs.errors)}</div>
          <div className="kpi-sub mono">{fmtPct(report.runs.errorRate)} rate</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Total tokens</div>
          <div className="kpi-v">{fmtN(report.runs.totalTokens)}</div>
        </div>
      </div>

      <div className="dash2-grid">
        <section className="dash-panel">
          <div className="dash-panel-h">Policy enforcement</div>
          <div className="kpi-row kpi-row-3 comp-kpi-inner">
            <div className="kpi">
              <div className="kpi-k">Active policies</div>
              <div className="kpi-v">{report.policies.total}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Calls evaluated</div>
              <div className="kpi-v">{fmtN(report.policies.totalEvaluations)}</div>
              <div className="kpi-sub mono">enforcement engine ran</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Total blocks</div>
              <div className="kpi-v">{fmtN(report.policies.totalBlocks)}</div>
            </div>
          </div>
          {report.policies.enforcements.length === 0 ? (
            <p className="empty comp-empty-sm comp-empty-flush">
              {report.policies.totalEvaluations > 0
                ? "No policy blocks recorded in this period — every evaluated call passed."
                : "No policy blocks recorded in this period."}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="appc-table">
                <thead>
                  <tr><th>Policy</th><th>Blocks</th><th>Last block</th></tr>
                </thead>
                <tbody>
                  {report.policies.enforcements.map((e) => (
                    <tr key={e.policy_name}>
                      <td className="mono">{e.policy_name}</td>
                      <td className="mono">{fmtN(e.blocks)}</td>
                      <td className="mono appc-dim">
                        {e.last_block_at ? new Date(e.last_block_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="dash-panel">
          <div className="dash-panel-h">Ledger integrity</div>

          {/* A failed integrity check is the single most alarming thing this
              product can report, and it used to be a stat tile visually
              identical to "Ledger entries — 19", distinguishable only by a
              30%-opacity border, with the reason as small grey text below the
              cards. Verification failing is not a metric; it is an alarm. */}
          {report.ledger.intact === false && (
            <div className="comp-integrity-alert" role="alert">
              <div className="comp-integrity-alert-h">
                <span className="comp-integrity-icon" aria-hidden>✗</span>
                Ledger verification FAILED
              </div>
              <p className="comp-integrity-alert-body">
                {report.ledger.intactNote ??
                  "The hash chain no longer reproduces. An entry has been altered, inserted or removed since it was sealed."}
              </p>
              <Link href="/app/ledger" className="btn-line comp-integrity-cta">Inspect the ledger →</Link>
            </div>
          )}

          <div className="kpi-row kpi-row-2 comp-kpi-inner">
            <div className="kpi">
              <div className="kpi-k">Ledger entries</div>
              <div className="kpi-v">{fmtN(report.ledger.entries)}</div>
            </div>
            <div className="kpi" data-tone={report.ledger.intact === false ? "rose" : report.ledger.intact ? "emerald" : undefined}>
              <div className="kpi-k">Verified intact</div>
              <div className="kpi-v">
                {report.ledger.intact === null ? "Unknown" : report.ledger.intact ? "Yes" : "No"}
              </div>
              <div className="kpi-sub mono">
                {report.ledger.sealed ? "checkpoint signed" : "not sealed"}
                {report.ledger.lastCheckpointAt ? ` · ${new Date(report.ledger.lastCheckpointAt).toLocaleDateString()}` : ""}
              </div>
            </div>
          </div>
          {report.ledger.intact !== false && (
            <p className="empty comp-empty-xs comp-empty-flush">
              {report.ledger.intactNote ?? "Verify in"} <Link href="/app/ledger" className="appc-link">Audit ledger →</Link>
            </p>
          )}
        </section>
      </div>

      <section className="dash-panel comp-panel-mt">
        <div className="dash-panel-h">Attestation</div>
        <p className="empty comp-empty-sm comp-attest-schema">
          Schema: <span className="mono">{report.attestation.schema}</span> · Redactions applied: <span className="mono">{fmtN(report.redactions.total)}</span>
          {Object.keys(report.redactions.byType).length > 0 && (
            <> (<span className="mono">{Object.entries(report.redactions.byType).map(([rule, n]) => `${rule}: ${n}`).join(" · ")}</span>)</>
          )}
        </p>
        <p className="empty comp-empty-xs comp-empty-flush">
          {report.attestation.note}
        </p>
      </section>
    </>
  );

  if (!allowed) {
    return (
      <div className="appc">
        <GateOverlay
          badge={`Compliance · ${planBadgeText("compliance")}`}
          title="One click to a regulator-ready evidence package."
          lead="Runback generates structured compliance artifacts: runs completed, policy enforcements, redactions applied, and ledger integrity — covering every AI oversight requirement. Available on Enterprise."
          ctaHref={UPGRADE_HREF}
          ctaLabel="Upgrade to Enterprise →"
        >
          {body}
        </GateOverlay>
      </div>
    );
  }

  return <div className="appc">{body}</div>;
}
