import { requireSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { listAdminEvents, verifyAdminChain, type AdminEvent, type AdminChainVerification } from "@/lib/adminAudit";
import { planBadgeText } from "@/lib/plans";
import GateOverlay from "../GateOverlay";
import SampleDataEmpty from "../SampleDataEmpty";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what a real operator audit trail looks like, not an empty table. GateOverlay
// only blurs its children with CSS, so this page must never pass a
// non-entitled org's own real actor/IP/target data into it.
const GLIMPSE_EVENTS: AdminEvent[] = [
  { seq: 3, event_id: "g3", actor_kind: "user", actor_email: "you@yourcompany.com", actor_label: null, action: "api_key.revoke", target_type: "api_key", target_id: "key_prod_1", metadata: {}, ip: "203.0.113.9", created_at: new Date(Date.now() - 3600_000).toISOString(), entry_hash: "", prev_hash: "", leaf_hash: "" },
  { seq: 2, event_id: "g2", actor_kind: "user", actor_email: "you@yourcompany.com", actor_label: null, action: "policy.update", target_type: "policy", target_id: "wire-transfer-guard", metadata: {}, ip: "203.0.113.9", created_at: new Date(Date.now() - 7200_000).toISOString(), entry_hash: "", prev_hash: "", leaf_hash: "" },
  { seq: 1, event_id: "g1", actor_kind: "user", actor_email: "sam@yourcompany.com", actor_label: null, action: "member.invite", target_type: "member", target_id: "priya@yourcompany.com", metadata: {}, ip: "203.0.113.4", created_at: new Date(Date.now() - 86400_000).toISOString(), entry_hash: "", prev_hash: "", leaf_hash: "" },
];
const GLIMPSE_CHAIN: AdminChainVerification = { intact: true, count: 3, head: "e4a1f9c2b7d03e5a1f9c2b7d03e5a1f9", brokenAt: null, anchored: true, anchorNote: "Illustrative.", witnesses: ["freetsa.org", "digicert"], note: "Illustrative — sign up to see your own." };

/** "policy.create" → "Policy created" reads as a sentence in a review. */
const VERB: Record<string, string> = {
  "policy.create": "Policy created",
  "policy.update": "Policy updated",
  "policy.delete": "Policy deleted",
  "api_key.create": "API key issued",
  "api_key.revoke": "API key revoked",
  "member.invite": "Member invited",
  "member.remove": "Member removed",
  "member.role_change": "Role changed",
  "session.revoke": "Sessions signed out",
  "sso.configure": "SSO configured",
  "sso.disable": "SSO disabled",
  "model_key.set": "Model key set",
  "model_key.delete": "Model key deleted",
  "evidence.export": "Evidence exported",
  "ledger.seal": "Checkpoint sealed",
  "legal_hold.place": "Legal hold placed",
  "legal_hold.release": "Legal hold released",
  "retention.change": "Retention changed",
  "org.settings_change": "Settings changed",
};

/** Actions that revoke access or move credentials — what an investigation opens with. */
const SENSITIVE = new Set([
  "api_key.revoke", "member.remove", "member.role_change", "session.revoke",
  "sso.configure", "sso.disable", "model_key.set", "model_key.delete",
  "legal_hold.release",
]);

export default async function AdminAuditPage() {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Rides on the existing compliance entitlement rather than inventing a tier:
  // the buyer who needs an operator audit trail is the one buying compliance.
  const allowed = demo || (await orgHasFeature(session.orgId, "compliance"));

  const [events, chain] = allowed
    ? await Promise.all([
        listAdminEvents(session.orgId, { limit: 200 }).catch(() => []),
        verifyAdminChain(session.orgId).catch(() => null),
      ])
    : [GLIMPSE_EVENTS, GLIMPSE_CHAIN];

  const head = (
    <div className="appc-head">
      <h1 className="appc-h1">Administrative audit log</h1>
      <p className="appc-sub">
        Every change made to Runback itself — who, what, when, and from where. Hash-chained, so an entry cannot be edited or removed without breaking it.
      </p>
    </div>
  );

  if (allowed && events.length === 0) {
    return (
      <div className="appc">
        {head}
        <SampleDataEmpty
          badge="Audit · operator actions"
          title="No administrative actions recorded yet."
          lead="This log records what your people do to Runback — issuing keys, changing policies, editing SSO, exporting evidence, releasing legal holds. It fills as your team administers the workspace."
          points={[
            "Each entry names the actor, their IP, and the exact target",
            "Chained to the previous entry, so deletion is detectable",
            "Verified by re-deriving every entry, not by trusting a flag",
          ]}
          foot="Change a setting or invite a teammate to see the first entry."
        />
      </div>
    );
  }

  const body = (
    <>
      {head}

      {chain && chain.intact === false && (
        <div className="comp-integrity-alert" role="alert">
          <div className="comp-integrity-alert-h">
            <span className="comp-integrity-icon" aria-hidden>✗</span>
            Audit log verification FAILED
          </div>
          <p className="comp-integrity-alert-body">{chain.note}</p>
        </div>
      )}

      <div className="kpi-row comp-kpi-row-mb">
        <div className="kpi">
          <div className="kpi-k">Actions recorded</div>
          <div className="kpi-v">{(chain?.count ?? events.length).toLocaleString()}</div>
        </div>
        <div
          className="kpi"
          data-tone={chain?.intact === false ? "rose" : chain?.intact ? "emerald" : undefined}
        >
          <div className="kpi-k">Chain verified</div>
          <div className="kpi-v">
            {chain == null || chain.intact === null ? "Unknown" : chain.intact ? "Yes" : "No"}
          </div>
          <div className="kpi-sub mono">
            {chain?.head ? `head ${chain.head.slice(0, 12)}…` : "no entries"}
          </div>
        </div>
      </div>

      <section className="dash-panel">
        <div className="dash-panel-h">Recent activity</div>
        <div className="table-wrap">
          <table className="appc-table">
            <thead>
              <tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.seq}>
                  <td className="mono appc-dim">{new Date(e.created_at).toLocaleString()}</td>
                  <td>
                    {e.actor_email ?? e.actor_label ?? "—"}
                    {e.actor_kind !== "user" && <span className="mono appc-dim"> · {e.actor_kind}</span>}
                  </td>
                  <td data-tone={SENSITIVE.has(e.action) ? "rose" : undefined}>
                    {VERB[e.action] ?? e.action}
                  </td>
                  <td className="mono appc-dim">
                    {e.target_type ? `${e.target_type}:${e.target_id ?? "—"}` : "—"}
                  </td>
                  <td className="mono appc-dim">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="empty comp-empty-xs comp-empty-flush">
          {chain?.note ?? "Showing the 200 most recent actions."}
        </p>
      </section>
    </>
  );

  if (!allowed) {
    return (
      <div className="appc">
        <GateOverlay
          badge={`Audit log · ${planBadgeText("compliance")}`}
          title="Prove who changed what, not just what your agents did."
          lead="Runback records every administrative action — key issuance, policy edits, SSO changes, evidence exports — in a hash-chained log that cannot be edited by the people it audits. The first thing a security reviewer asks for."
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
