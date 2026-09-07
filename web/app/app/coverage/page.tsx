import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { agentCoverage } from "@/lib/coverage";
import { atLeast } from "@/lib/auth";
import CoverageControls from "./CoverageControls";
import RetireAgentButton from "./RetireAgentButton";
import SampleDataEmpty from "../SampleDataEmpty";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  covered: "Covered",
  stale: "Stopped reporting",
  uninstrumented: "Not instrumented",
  undeclared: "Undeclared",
};

const TONE: Record<string, string | undefined> = {
  covered: "emerald",
  stale: "amber",
  uninstrumented: "rose",
  undeclared: "rose",
};

export default async function CoveragePage() {
  const session = await requireSession();
  // The layout redirects unauthenticated users, but a page and its layout render
  // CONCURRENTLY in the App Router — so `session!` here dereferences null before
  // that redirect lands, throwing on every unauthenticated request. The visitor
  // still gets the redirect, so it is invisible to them; what it does is fill
  // the error log with a fault that is really just a bot crawling /app.
  if (!session) redirect("/login");
  const cov = await agentCoverage(session.orgId).catch(() => null);

  if (!cov) {
    return (
      <div className="appc">
        <div className="appc-head">
          <h1 className="appc-h1">Governance coverage</h1>
        </div>
        <p className="empty">Could not compute coverage — the database may be unreachable.</p>
      </div>
    );
  }

  const head = (
    <div className="appc-head">
      <h1 className="appc-h1">Governance coverage</h1>
      <p className="appc-sub">
        How much of your agent estate is actually under observation — measured against the inventory you declare, not against what already reports here.
      </p>
    </div>
  );

  // Nothing declared and nothing observed: there is no estate to measure yet.
  if (cov.declared === 0 && cov.undeclared === 0) {
    return (
      <div className="appc">
        {head}
        <SampleDataEmpty
          badge="Coverage · estate"
          title="Declare the agents you expect to be governed."
          lead="Coverage compares your declared inventory against what has actually reported. Without a declared list the number would always be 100% — a reassuring figure that can never fall, which is worse than no figure at all."
          points={[
            "Declared but never seen — the real coverage gap",
            "Reporting, then silent — capture broke, or it was retired quietly",
            "Observed but never declared — an AI system your risk register does not know about",
          ]}
          foot="Paste your agent list below to start measuring."
        />
        <CoverageControls canAdmin={atLeast(session.role, "admin")} />
      </div>
    );
  }

  const pct = cov.coverageRate === null ? null : Math.round(cov.coverageRate * 100);
  const canAdmin = atLeast(session.role, "admin");

  return (
    <div className="appc">
      {head}

      {cov.criticalGaps.length > 0 && (
        <div className="comp-integrity-alert" role="alert">
          <div className="comp-integrity-alert-h">
            <span className="comp-integrity-icon" aria-hidden>✗</span>
            {cov.criticalGaps.length} critical or high-risk agent
            {cov.criticalGaps.length === 1 ? " is" : "s are"} not reporting
          </div>
          <p className="comp-integrity-alert-body">
            {cov.criticalGaps.map((g) => g.name).join(", ")} — either unmonitored, or capture has stopped without anyone noticing.
          </p>
        </div>
      )}

      <div className="kpi-row comp-kpi-row-mb">
        <div className="kpi" data-tone={pct !== null && pct < 80 ? "rose" : pct !== null ? "emerald" : undefined}>
          <div className="kpi-k">Under governance</div>
          <div className="kpi-v kpi-v-hero">{pct === null ? "—" : `${pct}%`}</div>
          <div className="kpi-sub mono">
            {cov.declared === 0 ? "nothing declared yet" : `${cov.covered} of ${cov.declared} declared`}
          </div>
        </div>
        <div className="kpi" data-tone={cov.uninstrumented > 0 ? "rose" : undefined}>
          <div className="kpi-k">Not instrumented</div>
          <div className="kpi-v">{cov.uninstrumented}</div>
        </div>
        <div className="kpi" data-tone={cov.stale > 0 ? "amber" : undefined}>
          <div className="kpi-k">Stopped reporting</div>
          <div className="kpi-v">{cov.stale}</div>
        </div>
        <div className="kpi" data-tone={cov.undeclared > 0 ? "rose" : undefined}>
          <div className="kpi-k">Undeclared</div>
          <div className="kpi-v">{cov.undeclared}</div>
          <div className="kpi-sub mono">running, not on the register</div>
        </div>
      </div>

      <section className="dash-panel">
        <div className="dash-panel-h">Estate</div>
        <div className="table-wrap">
          <table className="appc-table">
            <thead>
              <tr><th>Agent</th><th>Status</th><th>Criticality</th><th>Owner</th><th>Runs</th><th>Last seen</th>{canAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {cov.rows.map((r) => (
                <tr key={r.name}>
                  <td className="mono">{r.name}</td>
                  <td data-tone={TONE[r.status]}>{LABEL[r.status] ?? r.status}</td>
                  <td className="appc-dim">{r.criticality}</td>
                  <td className="appc-dim">{r.owner ?? "—"}</td>
                  <td className="mono appc-dim">{r.runs.toLocaleString()}</td>
                  <td className="mono appc-dim">
                    {r.last_seen ? new Date(r.last_seen).toLocaleDateString() : "never"}
                  </td>
                  {canAdmin && (
                    <td className="team-actions-cell">
                      {r.status === "undeclared" ? null : <RetireAgentButton name={r.name} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CoverageControls canAdmin={atLeast(session.role, "admin")} />
    </div>
  );
}
