"use client";

import { useState } from "react";
import Link from "next/link";

// ── Types (must match lib/multiAgent.ts AgentNode) ────────────────────────────

interface AgentNode {
  run_id: string;
  name: string;
  status: string;
  step_count: number | null;
  total_tokens: number | null;
  started_at: string | null;
  ended_at: string | null;
  parent_run_id: string | null;
  depth: number;
  children: AgentNode[];
}

interface AgentGraph {
  root: AgentNode;
  totalRuns: number;
  totalTokens: number;
  maxDepth: number;
}

// ── Internal row type ─────────────────────────────────────────────────────────

interface FlameRow {
  node: AgentNode;
  depth: number;
  startMs: number;    // absolute ms from epoch
  endMs: number;
  durationMs: number;
  leftPct: number;    // 0–100
  widthPct: number;   // 0–100
  isParallelWithSibling: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  success: "var(--emerald)",
  error:   "var(--rose)",
  running: "var(--blue)",
};

function nodeColor(status: string) {
  return STATUS_COLOR[status] ?? "var(--blue)";
}

function fmtDur(ms: number) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000)  return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}
function fmtTok(n: number | null) {
  if (!n) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ── Flatten tree into rows ordered by start time ──────────────────────────────

function flattenTree(root: AgentNode, globalStart: number, totalSpan: number): FlameRow[] {
  const rows: FlameRow[] = [];
  const siblingMap = new Map<string | null, AgentNode[]>();

  // Build sibling groups keyed by parent_run_id
  function collectSiblings(node: AgentNode) {
    for (const child of node.children) {
      if (!siblingMap.has(node.run_id)) siblingMap.set(node.run_id, []);
      siblingMap.get(node.run_id)!.push(child);
      collectSiblings(child);
    }
  }
  collectSiblings(root);

  function walk(node: AgentNode, depth: number) {
    const startMs = node.started_at ? new Date(node.started_at).getTime() : globalStart;
    const endMs   = node.ended_at   ? new Date(node.ended_at).getTime()   : globalStart + totalSpan;
    const durationMs = Math.max(0, endMs - startMs);
    const leftPct  = totalSpan > 0 ? ((startMs - globalStart) / totalSpan) * 100 : 0;
    const widthPct = totalSpan > 0 ? Math.max(0.5, (durationMs / totalSpan) * 100) : 100;

    // Detect parallel: any sibling overlaps in time
    const siblings = siblingMap.get(node.parent_run_id ?? "") ?? [];
    const isParallel = siblings.some(s => {
      if (s.run_id === node.run_id || !s.started_at || !s.ended_at || !node.started_at || !node.ended_at) return false;
      const sStart = new Date(s.started_at).getTime(), sEnd = new Date(s.ended_at).getTime();
      return sStart < endMs && startMs < sEnd;
    });

    rows.push({ node, depth, startMs, endMs, durationMs, leftPct, widthPct, isParallelWithSibling: isParallel });
    // Sort children by start time
    const sorted = [...node.children].sort((a, b) =>
      (a.started_at ?? "").localeCompare(b.started_at ?? "")
    );
    for (const child of sorted) walk(child, depth + 1);
  }

  walk(root, 0);
  return rows;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface Tooltip { row: FlameRow; x: number; y: number }

function FlameTooltip({ tip }: { tip: Tooltip }) {
  const { node, durationMs } = tip.row;
  return (
    <div
      className="flame-tooltip"
      style={{
        left: Math.min(tip.x + 12, typeof window !== "undefined" ? window.innerWidth - 260 : tip.x),
        top: tip.y + 12,
      }}
    >
      <div className="flame-tt-name mono">{node.name}</div>
      <div className="flame-tt-grid">
        <span className="flame-tt-k">Status</span>
        <span className="flame-tt-v mono" style={{ color: nodeColor(node.status) }}>{node.status}</span>
        <span className="flame-tt-k">Duration</span>
        <span className="flame-tt-v mono">{fmtDur(durationMs)}</span>
        <span className="flame-tt-k">Tokens</span>
        <span className="flame-tt-v mono">{fmtTok(node.total_tokens)}</span>
        <span className="flame-tt-k">Steps</span>
        <span className="flame-tt-v mono">{node.step_count ?? "—"}</span>
        <span className="flame-tt-k">Run ID</span>
        <span className="flame-tt-v mono" style={{ fontSize: "0.65rem", opacity: 0.6 }}>
          {node.run_id.slice(0, 8)}…
        </span>
      </div>
      <Link href={`/app/runs/${node.run_id}`} className="flame-tt-link mono">
        Open run →
      </Link>
    </div>
  );
}

// ── Time axis ─────────────────────────────────────────────────────────────────

function TimeAxis({ totalMs, ticks = 5 }: { totalMs: number; ticks?: number }) {
  const labels = Array.from({ length: ticks + 1 }, (_, i) => {
    const ms = (totalMs / ticks) * i;
    return { pct: (i / ticks) * 100, label: fmtDur(ms) };
  });
  return (
    <div className="flame-axis">
      {labels.map(({ pct, label }) => (
        <div key={pct} className="flame-axis-tick" style={{ left: `${pct}%` }}>
          <div className="flame-axis-line" />
          <div className="flame-axis-label mono">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AgentFlameGraph({ graph }: { graph: AgentGraph }) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  // Check if we have enough timing data
  function hasTimings(node: AgentNode): boolean {
    return !!node.started_at || node.children.some(hasTimings);
  }
  if (!hasTimings(graph.root)) return null;

  // Compute global time bounds
  function collectTimings(node: AgentNode, bounds: { min: number; max: number }) {
    if (node.started_at) bounds.min = Math.min(bounds.min, new Date(node.started_at).getTime());
    if (node.ended_at)   bounds.max = Math.max(bounds.max, new Date(node.ended_at).getTime());
    node.children.forEach(c => collectTimings(c, bounds));
  }
  const bounds = { min: Infinity, max: -Infinity };
  collectTimings(graph.root, bounds);
  if (bounds.min === Infinity) return null;

  const globalStart = bounds.min;
  const totalSpan   = Math.max(1, bounds.max - bounds.min);
  const rows        = flattenTree(graph.root, globalStart, totalSpan);

  const ROW_H = 36; // px per row
  const LABEL_W = 200; // px
  const totalHeight = rows.length * ROW_H + 32; // +32 for axis

  // Parallel groupings — count siblings running simultaneously for annotation
  const parallelGroups = rows.filter(r => r.isParallelWithSibling).length;

  return (
    <div className="flame-wrap">
      {/* Summary bar */}
      <div className="flame-summary">
        <span className="mono appc-dim" style={{ fontSize: "0.72rem" }}>
          {graph.totalRuns} agents · {fmtDur(totalSpan)} wall clock · {fmtTok(graph.totalTokens)} tokens total
        </span>
        {parallelGroups > 0 && (
          <span className="flame-parallel-badge">∥ parallel execution</span>
        )}
      </div>

      {/* Chart area */}
      <div className="flame-chart" style={{ height: totalHeight }}>
        {/* Label column — hidden via CSS on mobile (<640px), so no inline width needed there */}
        <div className="flame-labels" style={{ width: LABEL_W, minWidth: LABEL_W }}>
          {rows.map((row, i) => (
            <div
              key={row.node.run_id}
              className="flame-label-row"
              style={{ top: i * ROW_H, height: ROW_H, paddingLeft: 8 + row.depth * 16 }}
              onMouseEnter={e => setTooltip({ row, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
            >
              <span
                className="flame-label-dot"
                style={{ background: nodeColor(row.node.status) }}
              />
              <span className="flame-label-name mono">{row.node.name}</span>
              {row.isParallelWithSibling && (
                <span className="flame-parallel-icon" title="Running in parallel with sibling">∥</span>
              )}
            </div>
          ))}
        </div>

        {/* Bars column */}
        <div className="flame-bars">
          {/* Grid lines */}
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="flame-grid-line"
              style={{ left: `${(i / 4) * 100}%` }}
            />
          ))}

          {/* Agent bars */}
          {rows.map((row, i) => (
            <div
              key={row.node.run_id}
              className="flame-bar-row"
              style={{ top: i * ROW_H, height: ROW_H }}
            >
              <Link
                href={`/app/runs/${row.node.run_id}`}
                className="flame-bar"
                style={{
                  left: `${row.leftPct}%`,
                  width: `${row.widthPct}%`,
                  background: nodeColor(row.node.status),
                  opacity: 0.85,
                }}
                onMouseEnter={e => setTooltip({ row, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
                title={`${row.node.name} — ${fmtDur(row.durationMs)}`}
              >
                {row.widthPct > 8 && (
                  <span className="flame-bar-label mono">
                    {row.widthPct > 20 ? row.node.name + " · " : ""}
                    {fmtDur(row.durationMs)}
                  </span>
                )}
              </Link>
            </div>
          ))}

          {/* Time axis at bottom */}
          <TimeAxis totalMs={totalSpan} />
        </div>
      </div>

      {/* Per-agent token attribution */}
      {graph.totalTokens > 0 && (
        <div className="flame-attribution">
          <div className="flame-attr-h mono appc-dim">Token attribution</div>
          <div className="flame-attr-bars">
            {rows.filter(r => (r.node.total_tokens ?? 0) > 0).map(row => {
              const pct = ((row.node.total_tokens ?? 0) / Math.max(graph.totalTokens, 1)) * 100;
              return (
                <div key={row.node.run_id} className="flame-attr-row">
                  <div className="flame-attr-name mono" style={{ paddingLeft: row.depth * 12 }}>
                    <span className="flame-attr-dot" style={{ background: nodeColor(row.node.status) }} />
                    {row.node.name}
                  </div>
                  <div className="flame-attr-track">
                    <div className="flame-attr-fill" style={{ width: `${pct}%`, background: nodeColor(row.node.status) }} />
                  </div>
                  <div className="flame-attr-val mono">{fmtTok(row.node.total_tokens)}</div>
                  <div className="flame-attr-pct mono appc-dim">{pct.toFixed(1)}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tooltip && <FlameTooltip tip={tooltip} />}
    </div>
  );
}
