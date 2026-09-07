import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getIncident, type IncidentRow } from "@/lib/incidents";
import { can } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import IncidentActions from "./IncidentActions";
import GateOverlay from "../../GateOverlay";
import { GLIMPSE_INCIDENTS } from "../glimpseData";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

const SEV_LABEL: Record<string, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open", investigating: "Investigating", remediated: "Remediated", closed: "Closed",
};

function ts(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const EVENT_LABELS: Record<string, string> = {
  incident_opened:                 "Incident opened",
  status_changed_to_open:         "Reopened",
  status_changed_to_investigating: "Investigation started",
  status_changed_to_remediated:   "Marked remediated",
  status_changed_to_closed:       "Closed",
  updated:                        "Updated",
};

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession().catch(() => null);
  if (!session) redirect("/login");

  const entitled = can(session.orgPlan, "incidents");

  let incident: IncidentRow | null;
  if (entitled) {
    incident = await getIncident(id, session.orgId);
    // Real data legitimately missing for this id — a genuine not-found case,
    // independent of entitlement.
    if (!incident) notFound();
  } else {
    // Not entitled → don't fetch a real row (a non-entitled org has none of
    // its own, and the illustrative ids from the list glimpse aren't real
    // rows either). Render the matching illustrative fixture instead of
    // silently redirecting away.
    //
    // Only an id that actually belongs to the glimpse set resolves. This used
    // to fall back to GLIMPSE_INCIDENTS[0] for ANY id, so a mistyped or stale
    // URL rendered a fabricated incident — with a severity, a timeline and a
    // root cause — as though it were a real record under that id. A URL that
    // matches nothing is a 404, the same as it is for an entitled org.
    incident = GLIMPSE_INCIDENTS.find((g) => g.id === id) ?? null;
    if (!incident) notFound();
  }

  // "remediated" used to count as closed here, which hid IncidentActions
  // entirely — including the "Close incident" button IncidentActions itself
  // renders specifically for "remediated" (see its currentStatus ===
  // "remediated" branch). That branch was unreachable dead code: a remediated
  // incident could never actually be closed through the UI, only reopened by
  // editing the DB directly. "remediated" is a real, distinct, non-final
  // status (see STATUS_LABEL/EVENT_LABELS above) — only "closed" is terminal.
  const isClosed = incident.status === "closed";

  const body = (
    <div className="incd-page">
      <div className="incd-nav">
        <Link href="/app/incidents" className="incd-back mono">← Incidents</Link>
        <div className="incd-badges">
          <span className={`inc-sev inc-sev-${incident.severity}`}>{SEV_LABEL[incident.severity]}</span>
          <span className={`inc-status-chip inc-status-${incident.status}`}>{STATUS_LABEL[incident.status]}</span>
        </div>
      </div>

      <h1 className="incd-title">{incident.title}</h1>
      <div className="incd-meta mono">
        Opened {ts(incident.created_at)} by {incident.created_by}
        {incident.run_name && <> · Run: <Link href={`/app/runs/${incident.run_id}`} className="appc-link">{incident.run_name}</Link></>}
        {!incident.run_name && <> · <Link href={`/app/runs/${incident.run_id}`} className="appc-link mono">View run →</Link></>}
      </div>

      {/* ── Auto-RCA ─────────────────────────────────────────────────── */}
      <section className="incd-rca">
        <div className="incd-rca-head">
          <span className="incd-rca-title">Root cause</span>
          <span className="incd-rca-badge mono">auto-extracted</span>
        </div>
        {incident.root_cause ? (
          <p className="incd-rca-body">{incident.root_cause}</p>
        ) : (
          <p className="incd-rca-body incd-rca-empty">No root cause recorded. Add one below.</p>
        )}
        {incident.remediation && (
          <div className="incd-remediation">
            <span className="incd-remediation-label mono">Remediation</span>
            <p>{incident.remediation}</p>
          </div>
        )}
      </section>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      {!isClosed && (
        <IncidentActions
          incidentId={incident.id}
          runId={incident.run_id}
          currentStatus={incident.status}
          currentRootCause={incident.root_cause ?? ""}
          currentRemediation={incident.remediation ?? ""}
          hasGoldenRun={!!incident.golden_run_id}
        />
      )}

      {isClosed && incident.golden_run_id && (
        <div className="incd-closed-note mono">
          Regression test enrolled ·{" "}
          <Link href={`/app/runs/${incident.golden_run_id}`} className="appc-link">View golden run →</Link>
        </div>
      )}

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      <section className="incd-timeline">
        <h2 className="incd-section-title">Timeline</h2>
        <div className="incd-tl-list">
          {[...incident.timeline].reverse().map((entry, i) => (
            <div key={i} className="incd-tl-entry">
              <div className="incd-tl-dot" />
              <div className="incd-tl-content">
                <div className="incd-tl-event">{EVENT_LABELS[entry.event] ?? entry.event}</div>
                {entry.note && <div className="incd-tl-note">{entry.note}</div>}
                <div className="incd-tl-meta mono">{ts(entry.at)} · {entry.actor}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
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
