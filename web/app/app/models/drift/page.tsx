"use client";
import { UPGRADE_HREF } from "@/lib/edition";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { RingGauge, HBar } from "@/components/app/charts";

// ── Types (mirrored from lib/drift.ts for client-side use) ───────────────────

type DriftSeverity = "ok" | "info" | "warning" | "critical";

interface DriftSignal {
  metric: string;
  label: string;
  unit: string;
  baseline_mean: number;
  current_mean: number;
  z_score: number;
  pct_change: number;
  direction: "increase" | "decrease" | "stable";
  severity: DriftSeverity;
}

interface AgentDriftResult {
  agent: string;
  drift_score: number;
  severity: DriftSeverity;
  signals: DriftSignal[];
  all_signals: DriftSignal[];
  baseline_runs: number;
  current_runs: number;
  baseline_start: string;
  baseline_end: string;
  current_start: string;
  current_end: string;
}

interface RecentAlert {
  id: string;
  agent: string;
  detected_at: string;
  severity: DriftSeverity;
  drift_score: number;
  signals: DriftSignal[];
  baseline_start: string;
  baseline_end: string;
  current_start: string;
  current_end: string;
  baseline_runs: number;
  current_runs: number;
  acknowledged_at: string | null;
}

interface DriftReport {
  org_id: string;
  computed_at: string;
  overall_severity: DriftSeverity;
  overall_score: number;
  agents: AgentDriftResult[];
  recent_alerts: RecentAlert[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<DriftSeverity, string> = {
  ok:       "var(--emerald)",
  info:     "var(--blue)",
  warning:  "var(--amber)",
  critical: "var(--rose)",
};
const SEV_LABEL: Record<DriftSeverity, string> = {
  ok:       "Stable",
  info:     "Drifting",
  warning:  "Warning",
  critical: "Critical",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtTs(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtVal(signal: DriftSignal, v: number) {
  if (signal.metric === "error_rate" || signal.metric === "success_rate") return `${(v * 100).toFixed(1)}%`;
  if (signal.metric === "avg_latency") return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
  if (signal.metric === "tokens_per_run") return `${Math.round(v)} tok`;
  if (signal.metric === "tool_distribution") return `${v.toFixed(0)}% similar`;
  return v.toFixed(2);
}
function pctSign(n: number) { return n > 0 ? "+" : ""; }

// ── Gauge SVG ─────────────────────────────────────────────────────────────────

function DriftGauge({ score, severity }: { score: number; severity: DriftSeverity }) {
  const color = SEV_COLOR[severity];
  return (
    <RingGauge
      value={Math.min(score, 100)} size={120} stroke={8} color={color}
      topLabel="score" valueLabel={String(score)} subLabel={SEV_LABEL[severity].toUpperCase()}
      ariaLabel={`Drift score ${score}`}
    />
  );
}

// ── Signal row ────────────────────────────────────────────────────────────────

function SignalRow({ s }: { s: DriftSignal }) {
  const cPct = Math.min(100, Math.max(0, 50 + (s.pct_change / 2))); // rough visual proportion
  return (
    <div className="drift-signal" data-sev={s.severity}>
      <div className="drift-signal-top">
        <span className="drift-signal-label">{s.label}</span>
        <span className="drift-signal-z mono">
          z={s.z_score > 0 ? "+" : ""}{s.z_score.toFixed(2)}
        </span>
      </div>
      <div className="drift-signal-vals mono">
        <span className="drift-signal-val-b">
          <span className="drift-baseline-hint">baseline </span>
          {fmtVal(s, s.baseline_mean)}
        </span>
        <span className="drift-signal-arrow">
          {s.direction === "increase" ? "↑" : s.direction === "decrease" ? "↓" : "→"}
        </span>
        <span className="drift-signal-val-c">
          {fmtVal(s, s.current_mean)}
          <span className="drift-pct-change">
            ({pctSign(s.pct_change)}{s.pct_change.toFixed(1)}%)
          </span>
        </span>
      </div>
      <HBar
        pct={cPct} color={SEV_COLOR[s.severity]} height={4} refs={[50]}
        label={s.label}
        valueText={`baseline ${fmtVal(s, s.baseline_mean)} → now ${fmtVal(s, s.current_mean)} (${pctSign(s.pct_change)}${s.pct_change.toFixed(1)}%)`}
      />
    </div>
  );
}

// ── Agent card ────────────────────────────────────────────────────────────────

function AgentCard({ a }: { a: AgentDriftResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="drift-agent-card" data-sev={a.severity}>
      <button className="drift-agent-header" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
        <div className="drift-agent-identity">
          <span className="drift-agent-name mono">{a.agent}</span>
          <span className="drift-sev-badge">
            {SEV_LABEL[a.severity]}
          </span>
        </div>
        <div className="drift-agent-meta">
          <span className="drift-agent-score mono">
            {a.drift_score}<span className="drift-score-denom">/100</span>
          </span>
          <span className="drift-agent-runs mono">
            {a.current_runs} runs (7d) vs {a.baseline_runs} (baseline)
          </span>
          <span className="drift-expand-icon">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="drift-agent-body">
          <div className="drift-window-row mono">
            <span>Baseline: {fmtDate(a.baseline_start)} – {fmtDate(a.baseline_end)}</span>
            <span>Current: {fmtDate(a.current_start)} – today</span>
          </div>
          <div className="drift-signals-grid">
            {(a.all_signals ?? a.signals).map(s => (
              <SignalRow key={s.metric} s={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Alert history row ─────────────────────────────────────────────────────────

function AlertRow({ alert, onAck }: { alert: RecentAlert; onAck: (id: string) => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <tr className={alert.acknowledged_at ? "drift-acked" : undefined} data-sev={alert.severity}>
      <td className="mono drift-alert-sev-cell">{SEV_LABEL[alert.severity]}</td>
      <td className="mono">{alert.agent}</td>
      <td className="mono">{alert.drift_score.toFixed(0)}</td>
      <td className="mono appc-dim">{fmtTs(alert.detected_at)}</td>
      <td>
        <div className="drift-signal-tags">
          {alert.signals.slice(0, 3).map(s => (
            <span key={s.metric} className="drift-signal-tag" data-sev={s.severity}>
              {s.label}
            </span>
          ))}
          {alert.signals.length > 3 && <span className="drift-signal-tag appc-dim">+{alert.signals.length - 3}</span>}
        </div>
      </td>
      <td>
        {alert.acknowledged_at ? (
          <span className="mono appc-dim drift-ack-label">Ack&apos;d {fmtDate(alert.acknowledged_at)}</span>
        ) : (
          <button
            className="btn-line drift-ack-btn"
            disabled={pending}
            onClick={() => startTransition(async () => { onAck(alert.id); })}
          >
            {pending ? "…" : "Acknowledge"}
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

/** The bare fetch, shared by the mount effect and the Recompute button. */
async function fetchDriftReport(): Promise<DriftReport> {
  const res = await fetch("/api/drift/report");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || "Failed to load");
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export default function DriftPage() {
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` above on purpose: `error` drives a full-page
  // early-return replacing the whole report with just the error message —
  // fine for the initial load, wrong for a transient ack failure after the
  // report already rendered (it would blank out an otherwise-working page).
  const [ackError, setAckError] = useState<string | null>(null);
  const [gated, setGated] = useState(false);

  /** Recompute button. An event handler, so setting state synchronously is fine. */
  async function load() {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchDriftReport());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function handleAck(id: string) {
    // Never checked res.ok — a failed ack (network error, expired session,
    // 500) still flipped the row to "acknowledged" in local state, so it only
    // reverted, unexplained, on the next real fetch from the server.
    try {
      setAckError(null);
      const res = await fetch("/api/drift/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      if (!res.ok) { setAckError("Couldn't acknowledge that alert — try again."); return; }
      setReport(r => r ? {
        ...r,
        recent_alerts: r.recent_alerts.map(a => a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a),
      } : r);
    } catch {
      setAckError("Couldn't acknowledge that alert — try again.");
    }
  }

  useEffect(() => {
    // State lands only after an await, so nothing is set synchronously in the
    // effect body; `cancelled` keeps a late response from a unmounted page.
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchDriftReport();
        if (!cancelled) setReport(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setGated(e instanceof Error && (e as Error & { status?: number }).status === 403);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return (
    <div className="appc">
      <Link href="/app/models" className="apprun-back mono">← Models</Link>
      <div className="appc-head"><h1 className="appc-h1">Behavioral Drift</h1></div>
      <p className="empty drift-loading-msg">Computing drift across your agents…</p>
    </div>
  );

  if (error) return (
    <div className="appc">
      <Link href="/app/models" className="apprun-back mono">← Models</Link>
      <div className="appc-head"><h1 className="appc-h1">Behavioral Drift</h1></div>
      <p className="empty drift-error-msg">{error}</p>
      {gated && <Link href={`${UPGRADE_HREF}?plan=scale`} className="btn-fill">Upgrade to Scale →</Link>}
    </div>
  );

  if (!report) return null;

  const { overall_severity, overall_score, agents, recent_alerts, computed_at } = report;
  const unacked = recent_alerts.filter(a => !a.acknowledged_at);

  return (
    <div className="appc">
      <Link href="/app/models" className="apprun-back mono">← Models</Link>
      <div className="appc-head drift-head-row">
        <div>
          <h1 className="appc-h1">Behavioral Drift</h1>
          <p className="appc-sub">
            Detects when your agents deviate from their historical baseline — before error rates spike.
            <br />
            <span className="mono appc-dim drift-computed-at">
              Baseline: –30 to –8 days · Current window: last 7 days · Updated {fmtTs(computed_at)}
            </span>
          </p>
        </div>
        <button className="btn-line drift-recompute-btn" onClick={load}>
          Recompute
        </button>
      </div>

      {/* Overall status strip */}
      <div className="drift-status-strip" data-sev={overall_severity}>
        <div className="drift-gauge-wrap">
          <DriftGauge score={overall_score} severity={overall_severity} />
        </div>
        <div className="drift-status-info">
          <div className="drift-status-label">
            {overall_severity === "ok"
              ? "All agents stable"
              : `${agents.length} agent${agents.length !== 1 ? "s" : ""} drifting`}
          </div>
          {unacked.length > 0 && (
            <div className="drift-status-sub">
              {unacked.length} unacknowledged alert{unacked.length !== 1 ? "s" : ""}
            </div>
          )}
          <div className="kpi-row kpi-row-3 drift-status-kpi-row">
            <div className="kpi">
              <div className="kpi-k">Agents monitored</div>
              <div className="kpi-v drift-kpi-v-lg">
                {agents.length || recent_alerts.reduce((s, a) => { const n = new Set<string>(); n.add(a.agent); return n.size; }, 0)}
              </div>
            </div>
            <div className="kpi" data-tone={overall_severity === "critical" ? "rose" : undefined}>
              <div className="kpi-k">Unacked alerts</div>
              <div className="kpi-v drift-kpi-v-lg">{unacked.length}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Last 30d alerts</div>
              <div className="kpi-v drift-kpi-v-lg">{recent_alerts.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Current drift — live agents with drift detected */}
      {agents.length > 0 ? (
        <section className="drift-section">
          <div className="drift-section-h">Active drift</div>
          <div className="drift-agents-list">
            {agents.map(a => <AgentCard key={a.agent} a={a} />)}
          </div>
        </section>
      ) : (
        <section className="drift-section">
          <div className="drift-section-h">Active drift</div>
          <div className="drift-empty-state">
            <div className="drift-empty-icon">✓</div>
            <div className="drift-empty-title">All agents within baseline</div>
            <div className="drift-empty-sub">
              No agents are deviating more than 1.5σ from their 30-day baseline.
              {recent_alerts.length === 0 && " Drift detection requires at least 5 baseline runs and 3 current runs."}
            </div>
          </div>
        </section>
      )}

      {/* Alert history */}
      {recent_alerts.length > 0 && (
        <section className="drift-section">
          <div className="drift-section-h">Alert history (30 days)</div>
          {ackError && <p className="empty drift-error-msg">{ackError}</p>}
          <div className="table-wrap">
            <table className="appc-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Agent</th>
                  <th>Score</th>
                  <th>Detected</th>
                  <th>Signals</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent_alerts.map(a => (
                  <AlertRow key={a.id} alert={a} onAck={handleAck} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="drift-section drift-explainer">
        <div className="drift-section-h">How drift is detected</div>
        <div className="drift-explain-grid">
          {[
            { icon: "◉", title: "Z-score per signal", body: "Each metric (error rate, latency, tokens/run, tool usage) is compared against its baseline mean and standard deviation. |z| > 2 is a warning; |z| > 3 is critical." },
            { icon: "⊕", title: "Composite drift score", body: "The root-mean-square of all signal z-scores, scaled 0–100. A score of 0 means perfectly on-baseline. Above 50 typically indicates significant behavioral change." },
            { icon: "◈", title: "Tool pattern analysis", body: "The cosine similarity between tool call distributions in the baseline vs. current window. A shift > 25% signals the agent is using different tools or sequences." },
            { icon: "⊗", title: "Stable baseline window", body: "Baseline is always –30 to –8 days ago, giving a 22-day stable reference. The current window is the last 7 days. This separation prevents gradual drift from being invisible." },
          ].map(({ icon, title, body }) => (
            <div key={title} className="drift-explain-card">
              <div className="drift-explain-icon">{icon}</div>
              <div className="drift-explain-title">{title}</div>
              <div className="drift-explain-body">{body}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
