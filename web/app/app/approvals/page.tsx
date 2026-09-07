import { requireSession } from "@/lib/auth";
import { listApprovals, type ApprovalRow } from "@/lib/approvals";
import { getAnomalyFlags, type AnomalyFlagView } from "@/lib/toolAnomaly";
import { can } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import DecideButton from "./DecideButton";
import Link from "next/link";
import FeatureGate from "../FeatureGate";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what a real pending decision queue looks like, not an empty table.
const GLIMPSE_PENDING: ApprovalRow[] = [
  {
    id: "g1",
    org_id: "glimpse",
    run_id: "g-run-1",
    policy_name: "wire-transfer-guard",
    rule_desc: "Payments over $10,000 require human approval",
    context: {
      tool_name: "send_wire_transfer",
      run_name: "treasury-ops-agent",
      tool_input: { amount_usd: 48000, destination: "acct-9931" },
    },
    status: "pending",
    created_at: new Date(Date.now() - 6 * 60_000).toISOString(),
  },
  {
    id: "g2",
    org_id: "glimpse",
    run_id: "g-run-2",
    policy_name: "prod-access-guard",
    rule_desc: "Writes to production database require review",
    context: {
      tool_name: "run_sql",
      run_name: "data-migration-agent",
      tool_input: { query: "UPDATE accounts SET status = 'closed' WHERE ..." },
    },
    status: "pending",
    created_at: new Date(Date.now() - 22 * 60_000).toISOString(),
  },
  {
    id: "g3",
    org_id: "glimpse",
    run_id: "g-run-3",
    policy_name: "customer-comms-guard",
    rule_desc: "Outbound mass emails require sign-off",
    context: {
      tool_name: "send_bulk_email",
      run_name: "lifecycle-campaign-agent",
      tool_input: { recipients: 12400, template: "win-back-q3" },
    },
    status: "pending",
    created_at: new Date(Date.now() - 55 * 60_000).toISOString(),
  },
];

// Illustrative only — same reasoning as GLIMPSE_PENDING above.
const GLIMPSE_ANOMALIES: AnomalyFlagView[] = [
  { run_id: "g-run-4", tool_name: "issue_refund", field: "amount", value: 8400, baseline_mean: 210, z_score: 6.8, covered: false, agent_name: "support-refund-agent" },
];

function age(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ApprovalCard({ a, isAdmin }: { a: ApprovalRow; isAdmin: boolean }) {
  const toolName = a.context.tool_name as string | undefined;
  const runName = a.context.run_name as string | undefined;
  const input = a.context.tool_input as Record<string, unknown> | undefined;

  return (
    <div className="apv-card">
      <div className="apv-card-top">
        <div className="apv-card-left">
          {toolName && <span className="apv-tool mono">{toolName}</span>}
          {runName && <span className="apv-run">{runName}</span>}
        </div>
        <span className="apv-age mono">{age(a.created_at)}</span>
      </div>

      {a.rule_desc && (
        <div className="apv-rule">
          <span className="apv-rule-k">Rule</span>
          <span className="apv-rule-v">{a.rule_desc}</span>
        </div>
      )}

      {input && Object.keys(input).length > 0 && (
        <div className="apv-input mono">
          {Object.entries(input).map(([k, v]) => (
            <span key={k} className="apv-kv">
              <span className="apv-kv-k">{k}</span>
              <span className="apv-kv-v">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="apv-card-foot">
        <Link href={`/app/runs/${a.run_id}`} className="apv-run-link mono">
          View run →
        </Link>
        {a.policy_name && (
          <span className="apv-policy mono">{a.policy_name}</span>
        )}
        {isAdmin && a.status === "pending" && (
          <div className="apv-actions">
            <DecideButton id={a.id} decision="rejected" />
            <DecideButton id={a.id} decision="approved" />
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ a }: { a: ApprovalRow }) {
  const toolName = a.context.tool_name as string | undefined;
  const runName = a.context.run_name as string | undefined;
  const label =
    a.status === "approved" ? "Approved" :
    a.status === "rejected" ? "Rejected" :
    "Timed out";
  const tone =
    a.status === "approved" ? "apv-hist-approved" :
    a.status === "rejected" ? "apv-hist-rejected" :
    "apv-hist-timeout";
  return (
    <div className="apv-hist-row">
      <span className={`apv-hist-badge ${tone} mono`}>{label}</span>
      <span className="apv-hist-desc">
        {toolName && <span className="mono">{toolName}</span>}
        {runName && <> · {runName}</>}
      </span>
      <span className="apv-hist-meta mono">
        {a.decided_by ? `${a.decided_by} · ` : ""}{age(a.decided_at ?? a.created_at)}
      </span>
    </div>
  );
}

export default async function ApprovalsPage() {
  const session = await requireSession();
  const isAdmin = session.role === "admin" || session.role === "owner";
  const entitled = can(session.orgPlan, "approvals");

  const [pending, history, anomalies] = entitled
    ? await Promise.all([
        listApprovals(session.orgId, "pending"),
        listApprovals(session.orgId).then((all) => all.filter((a) => a.status !== "pending").slice(0, 50)),
        getAnomalyFlags(session.orgId).catch(() => [] as AnomalyFlagView[]),
      ])
    : [GLIMPSE_PENDING, [] as ApprovalRow[], GLIMPSE_ANOMALIES];

  // Genuine "0 pending" empty state only applies once entitled — a
  // non-entitled org always sees the illustrative glimpse queue above,
  // never this empty-state card.
  const genuinelyEmpty = entitled && pending.length === 0;

  const body = (
    <>
      {pending.length > 0 && (
        <section className="apv-pending-section">
          <div className="dash-panel-h apv-section-h">
            Pending
            <span className="apv-count-badge">{pending.length}</span>
          </div>
          <div className="apv-stack">
            {pending.map((a) => (
              <ApprovalCard key={a.id} a={a} isAdmin={entitled && isAdmin} />
            ))}
          </div>
        </section>
      )}

      {genuinelyEmpty && (
        <div className="appc-card apv-empty-card">
          <div className="apv-empty-msg">
            All clear — no pending decisions.
          </div>
          <div className="apv-empty-hint">
            There&apos;s no policy field that routes here automatically — call{" "}
            <span className="mono">POST /api/approvals</span> from your own agent code at the point
            you want a human decision, typically right before a policy-flagged action would
            otherwise run.
          </div>
        </div>
      )}

      {anomalies.length > 0 && (
        <section className="apv-anomaly-section">
          <div className="dash-panel-h apv-section-h">
            Anomalous — flagged for review
            <span className="apv-count-badge apv-count-badge--anomaly">{anomalies.length}</span>
          </div>
          <p className="apv-anomaly-lead">
            Statistical outliers against each tool&apos;s own history — no rule matched, nothing was blocked. This is a
            review signal, not a verdict. Tools with no policy coverage at all are listed first.
          </p>
          <div className="apv-stack">
            {anomalies.map((f, i) => (
              <div key={`${f.run_id}-${f.tool_name}-${f.field}-${i}`} className="apv-anomaly-card">
                <div className="apv-anomaly-top">
                  <span className="mono apv-tool">{f.tool_name}</span>
                  {f.agent_name && <span className="apv-run">{f.agent_name}</span>}
                  <span className={`apv-anomaly-badge ${f.covered ? "apv-anomaly-badge--covered" : "apv-anomaly-badge--uncovered"}`}>
                    {f.covered ? "rule exists" : "no policy coverage"}
                  </span>
                </div>
                <div className="apv-anomaly-detail mono">
                  {f.field}: {f.value.toLocaleString()} vs. baseline avg {Math.round(f.baseline_mean).toLocaleString()} · z={f.z_score}
                </div>
                <Link href={`/app/runs/${f.run_id}`} className="apv-run-link mono">View run →</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section>
          <div className="dash-panel-h apv-section-h">History</div>
          <div className="apv-hist">
            {history.map((a) => (
              <HistoryRow key={a.id} a={a} />
            ))}
          </div>
        </section>
      )}
    </>
  );

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Approvals</h1>
        <p className="appc-sub">
          {genuinelyEmpty
            ? "No decisions waiting."
            : `${pending.length} decision${pending.length === 1 ? "" : "s"} waiting for review.`}
        </p>
      </div>
      <FeatureGate
        allowed={entitled}
        badge={planBadgeText("approvals")}
        title={`Approval queue requires ${planBadgeText("approvals")}`}
        lead="Human-in-the-loop review queue for high-stakes agent decisions."
        ctaHref={UPGRADE_HREF}
        ctaLabel="Upgrade →"
      >
        {body}
      </FeatureGate>
    </div>
  );
}
