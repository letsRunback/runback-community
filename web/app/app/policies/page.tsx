import { requireSession } from "@/lib/auth";
import { listPolicies, type PolicyRow } from "@/lib/eval/policies";
import { getCoverageGaps } from "@/lib/policyCoverage";
import PolicyEditor from "./PolicyEditor";
import SampleDataEmpty from "../SampleDataEmpty";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const session = await requireSession();
  let policies: PolicyRow[] = [];
  try { policies = await listPolicies(session.orgId); } catch { /* db */ }
  const gaps = await getCoverageGaps(session.orgId).catch(() => []);

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Policies</h1>
        <p className="appc-sub">Know exactly how many past decisions a new rule would have blocked — before it&apos;s live and before it costs you anything.</p>
      </div>

      {policies.length === 0 && (
        <div className="policies-empty-wrap">
          <SampleDataEmpty
            badge="Policies · governance as code"
            title="A precise rule your gate enforces — every time."
            lead={'A policy is a versioned set of deterministic rules over an agent\'s decision. No fuzzy judge: an exact, auditable verdict. The flagship rule — “a disputed refund over $100 must be escalated” — is below as a template.'}
            points={[
              "Compound, conditional rules: when X, then Y must hold",
              "Reads tool calls, their arguments, the output — exactly",
              "Versioned: every eval records which policy version it ran",
            ]}
          />
        </div>
      )}

      {policies.length > 0 && (
        <div className="table-wrap policies-table-wrap">
          <table className="appc-table">
            <thead><tr><th>Policy</th><th>Version</th><th>Rules</th><th>Updated</th></tr></thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.name}</td>
                  <td className="mono appc-dim">v{p.version}</td>
                  <td className="mono">{p.rules.length}</td>
                  <td className="mono appc-dim">{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="dash-panel cov-gap-panel">
          <div className="dash-panel-h">
            Coverage gaps
            <span className="cov-gap-count mono">{gaps.length} tool{gaps.length === 1 ? "" : "s"}</span>
          </div>
          <p className="cov-gap-lead">
            These tools were actually called in the last 90 days, and no active rule&apos;s <span className="mono">tool_called</span> or{" "}
            <span className="mono">tool_arg</span> predicate even names them — not &quot;a rule exists and didn&apos;t fire,&quot; there is
            nothing that could have blocked a bad call to them, even in principle. Ranked by how often they&apos;re actually used.
          </p>
          <ul className="cov-gap-list">
            {gaps.slice(0, 20).map((g) => (
              <li key={g.tool_name}>
                <span className="mono cov-gap-tool">{g.tool_name}</span>
                <span className="mono cov-gap-n">{g.count.toLocaleString()} call{g.count === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
          {gaps.length > 20 && <p className="cov-gap-more mono">+{gaps.length - 20} more uncovered tools</p>}
        </div>
      )}

      <div className="dash-panel-h">New policy / version</div>
      <PolicyEditor />
    </div>
  );
}
