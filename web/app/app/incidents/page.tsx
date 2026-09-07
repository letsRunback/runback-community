import Link from "next/link";
import { getSession } from "@/lib/auth";
import { listIncidents } from "@/lib/incidents";
import { can } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import { redirect } from "next/navigation";
import GateOverlay from "../GateOverlay";
import { GLIMPSE_INCIDENTS } from "./glimpseData";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const SEV_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function age(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function IncidentsPage() {
  const session = await getSession().catch(() => null);
  if (!session) redirect("/login");

  const entitled = can(session.orgPlan, "incidents");
  // Not entitled → show the illustrative fixture, blurred under the gate, so
  // the glimpse has real-shaped incident cards instead of an empty list.
  const all = entitled ? await listIncidents(session.orgId) : GLIMPSE_INCIDENTS;
  const open = all.filter(i => i.status === "open" || i.status === "investigating");
  const closed = all.filter(i => i.status === "remediated" || i.status === "closed");

  const body = (
    <div className="inc-page">
      <div className="inc-header">
        <div>
          <h1>Incidents</h1>
          <p className="inc-sub">Auto-RCA from policy blocks. Root cause pre-populated. No log digging.</p>
        </div>
        {open.length > 0 && (
          <span className="inc-open-badge">{open.length} open</span>
        )}
      </div>

      {/* Genuinely empty (entitled, no incidents) — distinct from the not-entitled glimpse below. */}
      {entitled && open.length === 0 && closed.length === 0 && (
        <div className="inc-empty">
          <div className="inc-empty-icon">✦</div>
          <p>No incidents yet.</p>
          <p className="mono inc-empty-hint">
            When a run is blocked by policy, open it as an incident to track root cause and resolution.
          </p>
        </div>
      )}

      {open.length > 0 && (
        <section className="inc-section">
          <h2 className="inc-section-title">Open · {open.length}</h2>
          <div className="inc-list">
            {open
              .sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9))
              .map(inc => (
                <Link key={inc.id} href={`/app/incidents/${inc.id}`} className="inc-card" tabIndex={entitled ? undefined : -1}>
                  <div className="inc-card-top">
                    <span className={`inc-sev inc-sev-${inc.severity}`}>{SEV_LABEL[inc.severity]}</span>
                    <span className={`inc-status-chip inc-status-${inc.status}`}>{inc.status}</span>
                  </div>
                  <div className="inc-card-title">{inc.title}</div>
                  {inc.root_cause && (
                    <div className="inc-card-rca mono">{inc.root_cause.slice(0, 100)}{inc.root_cause.length > 100 ? "…" : ""}</div>
                  )}
                  <div className="inc-card-meta mono">
                    <span>{inc.run_name ?? inc.run_id.slice(0, 12)}</span>
                    <span>{age(inc.created_at)}</span>
                  </div>
                </Link>
              ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <section className="inc-section">
          <h2 className="inc-section-title">Resolved · {closed.length}</h2>
          <div className="inc-list">
            {closed.map(inc => (
              <Link key={inc.id} href={`/app/incidents/${inc.id}`} className="inc-card inc-card-closed" tabIndex={entitled ? undefined : -1}>
                <div className="inc-card-top">
                  <span className={`inc-sev inc-sev-${inc.severity}`}>{SEV_LABEL[inc.severity]}</span>
                  <span className={`inc-status-chip inc-status-${inc.status}`}>{inc.status}</span>
                </div>
                <div className="inc-card-title">{inc.title}</div>
                <div className="inc-card-meta mono">
                  <span>{inc.run_name ?? inc.run_id.slice(0, 12)}</span>
                  <span>{age(inc.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  if (!entitled) {
    return (
      <GateOverlay
        badge={planBadgeText("incidents")}
        title="Incident response is a paid feature"
        lead="Auto-RCA from your first policy block. Know the root cause before you open the ticket. Available on Growth and above."
        ctaHref={UPGRADE_HREF}
        ctaLabel="Upgrade to unlock →"
      >
        {body}
      </GateOverlay>
    );
  }

  return body;
}
