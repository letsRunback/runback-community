"use client";
import { UPGRADE_HREF } from "@/lib/edition";

import { useEffect, useState } from "react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentRoleStat {
  name: string;
  as_orchestrator: number;
  as_subagent: number;
  avg_tokens: number;
  p50_duration_ms: number;
  p90_duration_ms: number;
  error_rate: number;
  total_tokens: number;
  is_bottleneck: boolean;
}

interface RecentOrchestration {
  run_id: string;
  name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  total_tokens: number;
  child_count: number;
  max_depth: number;
  is_parallel: boolean;
}

interface TopologyReport {
  window_days: number;
  total_orchestrations: number;
  total_agent_invocations: number;
  avg_tree_depth: number;
  avg_fanout: number;
  total_tokens_across_trees: number;
  parallel_pct: number;
  agent_stats: AgentRoleStat[];
  recent_orchestrations: RecentOrchestration[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtMs = (ms: number | null) => {
  if (!ms || ms <= 0) return "—";
  return ms >= 60000
    ? `${(ms / 60000).toFixed(1)}m`
    : ms >= 1000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${ms}ms`;
};
const fmtTok = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ── Agent role badge ──────────────────────────────────────────────────────────

function RoleBadge({ stat }: { stat: AgentRoleStat }) {
  const isOrch = stat.as_orchestrator > 0;
  const isSub  = stat.as_subagent > 0;
  return (
    <span className="topo-roles">
      {isOrch && <span className="topo-role-badge topo-role-orch">Orchestrator</span>}
      {isSub  && <span className="topo-role-badge topo-role-sub">Subagent</span>}
    </span>
  );
}

// ── Mini bar for tokens proportion ───────────────────────────────────────────

function TokenBar({ pct }: { pct: number }) {
  return (
    <div className="topo-tok-bar-wrap">
      <div className="topo-tok-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ── Topology tree ASCII preview ───────────────────────────────────────────────

function TreePreview({ depth, fanout, parallel }: { depth: number; fanout: number; parallel: boolean }) {
  const rows = [];
  rows.push(
    <div key="root" className="topo-tree-row">
      <span className="topo-tree-node topo-tree-root">●</span>
      <span className="mono appc-dim topo-tree-root-label">root</span>
    </div>
  );
  const children = Math.min(fanout, 4);
  const label = parallel ? "∥" : "→";
  for (let i = 0; i < children; i++) {
    rows.push(
      <div key={i} className="topo-tree-row topo-tree-child">
        <span className="topo-tree-edge mono appc-dim">{i < children - 1 ? "├" : "└"}─</span>
        <span className="topo-tree-node">●</span>
        {i === 0 && <span className="mono appc-dim topo-tree-exec-label">{label} {parallel ? "parallel" : "serial"}</span>}
      </div>
    );
    if (depth > 1 && i === 0) {
      rows.push(
        <div key="grandchild" className="topo-tree-row topo-tree-grandchild-row">
          <span className="topo-tree-edge mono appc-dim">└─</span>
          <span className="topo-tree-node topo-tree-node-faded">●</span>
        </div>
      );
    }
  }
  if (fanout > 4) rows.push(
    <div key="more" className="topo-tree-row topo-tree-child">
      <span className="mono appc-dim topo-tree-more-label">  ⋮ +{fanout - 4} more</span>
    </div>
  );
  return <div className="topo-tree">{rows}</div>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TopologyPage() {
  const [report, setReport] = useState<TopologyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const [days, setDays] = useState(30);

  useEffect(() => {
    // Cancellation is not cosmetic here: `days` can change while a request is in
    // flight, and without this guard a slower earlier response can land after a
    // newer one and overwrite it. Every state update also sits behind an await,
    // so nothing is set synchronously in the effect body.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/topology?days=${days}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (!cancelled) setGated(res.status === 403);
          throw new Error(body?.error || `Failed to load (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) { setReport(json); setError(null); setGated(false); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const maxTok = report?.agent_stats.length
    ? Math.max(...report.agent_stats.map(s => s.total_tokens), 1)
    : 1;

  return (
    <div className="appc">
      <Link href="/app/runs" className="apprun-back mono">← Runs</Link>
      <div className="appc-head topo-head-row">
        <div>
          <h1 className="appc-h1">Orchestration topology</h1>
          <p className="appc-sub">
            Fleet-wide view of your multi-agent execution graphs —
            who calls whom, where latency accumulates, which subagents fail most.
          </p>
        </div>
        <div className="topo-window-pills">
          {[7, 30, 90].map(d => (
            <button key={d} className={`topo-pill mono${days === d ? " topo-pill-active" : ""}`}
              onClick={() => { setDays(d); }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="empty topo-loading">Loading topology…</p>}
      {error   && (
        <>
          <p className="empty topo-error">{error}</p>
          {gated && <Link href={`${UPGRADE_HREF}?plan=scale`} className="btn-fill">Upgrade to Scale →</Link>}
        </>
      )}

      {!loading && report && report.total_orchestrations === 0 && (
        <div className="topo-empty">
          <div className="topo-empty-icon">⬡</div>
          <div className="topo-empty-title">No orchestrations yet</div>
          <div className="topo-empty-sub">
            When one of your agents spawns another, Runback automatically links them
            via <code className="mono">parent_run_id</code> in the run start metadata.
            The graph appears here once at least two agents participate in a single execution.
          </div>
          <div className="topo-empty-code">
            <div className="mono appc-dim topo-code-hint">SDK — pass parent_run_id when spawning a subagent</div>
            <pre className="mono topo-empty-pre">
{`await runback.run(subAgentFn, {
  metadata: { parent_run_id: ctx.runId }
})`}
            </pre>
          </div>
        </div>
      )}

      {!loading && report && report.total_orchestrations > 0 && (
        <>
          {/* KPI summary — 6 items, 3-col grid wraps evenly */}
          <div className="kpi-row kpi-row-3 topo-kpi-mb">
            <div className="kpi">
              <div className="kpi-k">Orchestrations</div>
              <div className="kpi-v">{report.total_orchestrations}</div>
              <div className="kpi-sub mono">{report.window_days}d window</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Agent invocations</div>
              <div className="kpi-v">{report.total_agent_invocations}</div>
              <div className="kpi-sub mono">across all trees</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Avg depth</div>
              <div className="kpi-v">{report.avg_tree_depth}</div>
              <div className="kpi-sub mono">levels deep</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Avg fanout</div>
              <div className="kpi-v">{report.avg_fanout}</div>
              <div className="kpi-sub mono">direct children</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Parallel executions</div>
              <div className="kpi-v">{report.parallel_pct}%</div>
              <div className="kpi-sub mono">of orchestrations</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">Total tokens</div>
              <div className="kpi-v">{fmtTok(report.total_tokens_across_trees)}</div>
              <div className="kpi-sub mono">across all trees</div>
            </div>
          </div>

          <div className="topo-body">
            {/* Left: agent role table */}
            <section className="topo-section">
              <div className="topo-section-h">Agent roles & cost</div>
              <div className="table-wrap">
                <table className="appc-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Role</th>
                      <th>Calls</th>
                      <th>Avg tokens</th>
                      <th>P90 latency</th>
                      <th>Error rate</th>
                      <th>Token share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.agent_stats.map(s => (
                      <tr key={s.name} data-bottleneck={s.is_bottleneck || undefined}>
                        <td>
                          <span className="mono">{s.name}</span>
                          {s.is_bottleneck && (
                            <span className="topo-bottleneck-tag">bottleneck</span>
                          )}
                        </td>
                        <td><RoleBadge stat={s} /></td>
                        <td className="mono">{s.as_orchestrator + s.as_subagent}</td>
                        <td className="mono">{fmtTok(s.avg_tokens)}</td>
                        <td className="mono">{fmtMs(s.p90_duration_ms)}</td>
                        <td className="mono" data-tone={s.error_rate > 0.1 ? "rose" : undefined}>
                          {fmtPct(s.error_rate)}
                        </td>
                        <td className="topo-tok-col">
                          <TokenBar pct={(s.total_tokens / maxTok) * 100} />
                          <span className="mono appc-dim topo-tok-label">
                            {fmtTok(s.total_tokens)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Right: avg tree shape */}
            <aside className="topo-aside">
              <div className="topo-section-h">Avg tree shape</div>
              <div className="topo-shape-card">
                <TreePreview
                  depth={Math.round(report.avg_tree_depth)}
                  fanout={Math.round(report.avg_fanout)}
                  parallel={report.parallel_pct >= 50}
                />
                <div className="topo-shape-stats">
                  <div className="topo-shape-stat">
                    <span className="topo-shape-k">Depth</span>
                    <span className="topo-shape-v mono">{report.avg_tree_depth}</span>
                  </div>
                  <div className="topo-shape-stat">
                    <span className="topo-shape-k">Fanout</span>
                    <span className="topo-shape-v mono">{report.avg_fanout}</span>
                  </div>
                  <div className="topo-shape-stat">
                    <span className="topo-shape-k">Parallel</span>
                    <span className="topo-shape-v mono">{report.parallel_pct}%</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>

          {/* Recent orchestrations */}
          <section className="topo-section topo-recent-section">
            <div className="topo-section-h">Recent orchestrations — open any to see the flame graph</div>
            <div className="table-wrap">
              <table className="appc-table">
                <thead>
                  <tr>
                    <th>Orchestrator</th>
                    <th>Status</th>
                    <th>Children</th>
                    <th>Depth</th>
                    <th>Execution</th>
                    <th>Duration</th>
                    <th>Tokens</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {report.recent_orchestrations.map(r => (
                    <tr key={r.run_id}>
                      <td>
                        <Link href={`/app/runs/${r.run_id}`} className="mono appc-link">
                          {r.name}
                        </Link>
                      </td>
                      <td>
                        <span className={`pill pill-${r.status === "error" ? "error" : r.status === "success" ? "ok" : "muted"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="mono">{r.child_count}</td>
                      <td className="mono">{r.max_depth}</td>
                      <td>
                        <span className={`topo-exec-badge${r.is_parallel ? " topo-exec-parallel" : " topo-exec-serial"}`}>
                          {r.is_parallel ? "∥ parallel" : "→ serial"}
                        </span>
                      </td>
                      <td className="mono">{fmtMs(r.duration_ms)}</td>
                      <td className="mono">{fmtTok(r.total_tokens)}</td>
                      <td className="mono appc-dim">{r.started_at ? fmtDate(r.started_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
