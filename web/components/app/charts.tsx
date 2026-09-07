"use client";

/**
 * Lightweight, dependency-free SVG charts for the control room. Client-rendered
 * (hover state needs it) and styled for a premium feel — gradient area fills,
 * hairline gridlines, and an arc-based health ring.
 *
 * Every chart here takes its hover tooltip content from the SAME data already
 * driving what's drawn — there is no separate "display" vs. "tooltip" copy of
 * a number to let drift, and no illustrative/placeholder content baked into
 * this file. Callers that need an illustrative preview (a non-entitled org's
 * GateOverlay, a GLIMPSE_* fixture) pass illustrative values in through these
 * same props, same as real data — the chart itself never hard-codes a value.
 */

import { useState } from "react";

interface TipRow { k: string; v: string; color?: string }
interface TipState { x: number; y: number; title?: string; rows: TipRow[] }

/** One tooltip implementation, reused by every chart below — see AgentFlameGraph.tsx's
 *  FlameTooltip for the pattern this was lifted from (mouse-tracked, fixed position). */
function ChartTooltip({ tip }: { tip: TipState }) {
  return (
    <div
      className="chart-tooltip"
      style={{
        left: Math.min(tip.x + 12, typeof window !== "undefined" ? window.innerWidth - 240 : tip.x),
        top: tip.y + 12,
      }}
    >
      {tip.title && <div className="chart-tt-title mono">{tip.title}</div>}
      {tip.rows.map((r) => (
        <div className="chart-tt-row" key={r.k}>
          <span className="chart-tt-k">{r.k}</span>
          <span className="chart-tt-v mono" style={r.color ? { color: r.color } : undefined}>{r.v}</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({
  values, labels, color = "var(--blue)", w = 104, h = 30,
}: { values: number[]; labels?: string[]; color?: string; w?: number; h?: number }) {
  const [tip, setTip] = useState<TipState | null>(null);
  if (!values.length) return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none" className="spark" />;
  const max = Math.max(1, ...values);
  const n = values.length;
  const px = (i: number) => (i / Math.max(1, n - 1)) * w;
  const py = (v: number) => h - (v / max) * (h - 4) - 2;
  const pts = values.map((v, i) => [px(i), py(v)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const id = `sp-${color.replace(/[^a-z]/gi, "")}-${n}`;
  // Each point gets an invisible hit-region roughly one point wide, matching
  // AreaChart's own hover-rect approach — a thin stroked line has almost no
  // hoverable area on its own.
  const cellW = w / n;
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none" className="spark">
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.25" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <rect
            key={i}
            x={px(i) - cellW / 2} y={0} width={cellW} height={h}
            fill="transparent"
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, title: labels?.[i], rows: [{ k: "value", v: v.toLocaleString(), color }] })}
            onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      {tip && <ChartTooltip tip={tip} />}
    </>
  );
}

/**
 * General circular gauge — the one ring-drawing implementation in the app.
 * Two independent hand-rolled versions existed before this (HealthRing here,
 * and a separate path-based SVG in models/drift/page.tsx with different
 * geometry, coordinate system, and text sizing) — both now render through
 * this. `value`/`max` rather than a 0-1 fraction so callers with a natural
 * 0-100 scale (a drift score) don't have to divide by 100 first.
 */
export function RingGauge({
  value, max = 100, size = 92, stroke = 9, color, trackColor = "var(--border-subtle)",
  valueLabel, subLabel, topLabel, ariaLabel,
}: {
  value: number; max?: number; size?: number; stroke?: number; color: string; trackColor?: string;
  valueLabel: string; subLabel?: string; topLabel?: string; ariaLabel?: string;
}) {
  const [tip, setTip] = useState<TipState | null>(null);
  const frac = Math.max(0, Math.min(1, value / max));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2, cy = size / 2;
  // The rendered valueLabel is often rounded for display ("94%") — the
  // tooltip shows the exact underlying number, not a re-derivation of the
  // rounded text, so hovering answers "exactly how much" rather than
  // repeating what's already on screen.
  return (
    <>
      <svg
        viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="ringgauge" aria-label={ariaLabel}
        onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, title: topLabel ?? subLabel, rows: [{ k: "exact value", v: `${value.toLocaleString()} / ${max.toLocaleString()}`, color }] })}
        onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
        onMouseLeave={() => setTip(null)}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} transform={`rotate(-90 ${cx} ${cy})`}
          className="ringgauge-arc"
        />
        {topLabel && <text x="50%" y={size * 0.36} textAnchor="middle" className="ringgauge-top" fill="var(--text-muted)">{topLabel}</text>}
        <text x="50%" y={topLabel ? size * 0.56 : "48%"} textAnchor="middle" className="ringgauge-val" fill="var(--text-primary)">{valueLabel}</text>
        {subLabel && <text x="50%" y={topLabel ? size * 0.74 : "64%"} textAnchor="middle" className="ringgauge-sub" fill={color}>{subLabel}</text>}
      </svg>
      {tip && <ChartTooltip tip={tip} />}
    </>
  );
}

export function HealthRing({ pct, size = 92 }: { pct: number; size?: number }) {
  const color = pct >= 0.95 ? "var(--emerald)" : pct >= 0.85 ? "var(--amber)" : "var(--rose)";
  return (
    <RingGauge
      value={pct * 100} size={size} color={color}
      valueLabel={`${Math.round(pct * 100)}%`} subLabel="success"
    />
  );
}

/**
 * Horizontal comparison bar — the one implementation for "this value vs. a
 * scale" across the app. Before this, benchmark/cost/regulatory/drift/
 * overview each hand-rolled their own track height, radius, and track color.
 * `refs` draws thin reference ticks (e.g. benchmark's p50/p75 markers).
 * `label`/`valueText` are optional because only the caller knows what the
 * percentage MEANS at that call site (budget utilization vs. fleet
 * percentile vs. framework score) — when supplied, hovering shows them;
 * when not, the bar has no tooltip rather than a meaningless one.
 */
export function HBar({
  pct, color, height = 5, refs, trackColor = "var(--border-subtle)", label, valueText,
}: {
  pct: number; color: string; height?: number; refs?: number[]; trackColor?: string;
  label?: string; valueText?: string;
}) {
  const [tip, setTip] = useState<TipState | null>(null);
  const clamped = Math.max(0, Math.min(100, pct));
  const hoverable = !!(label || valueText);
  return (
    <>
      <div
        className="hbar-track" style={{ height, background: trackColor, borderRadius: height / 2 }}
        onMouseEnter={hoverable ? (e) => setTip({ x: e.clientX, y: e.clientY, title: label, rows: [{ k: "value", v: valueText ?? `${Math.round(clamped)}%`, color }] }) : undefined}
        onMouseMove={hoverable ? (e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t)) : undefined}
        onMouseLeave={hoverable ? () => setTip(null) : undefined}
      >
        {refs?.map((r) => (
          <div key={r} className="hbar-ref" style={{ left: `${Math.max(0, Math.min(100, r))}%` }} />
        ))}
        <div className="hbar-fill" style={{ width: `${clamped}%`, background: color, borderRadius: height / 2 }} />
      </div>
      {tip && <ChartTooltip tip={tip} />}
    </>
  );
}

export interface BarChartMiniItem { key: string; value: number; label: string; title?: string }

/** Vertical mini bar chart — replaces golden's hand-rolled weekly-enrollment bars. */
export function BarChartMini({ data, color = "var(--blue)", height = 60 }: { data: BarChartMiniItem[]; color?: string; height?: number }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="barmini-row" style={{ height }}>
      {data.map((d) => (
        <div key={d.key} className="barmini-col">
          <div
            className="barmini-bar"
            style={{
              height: `${Math.max(3, (d.value / max) * height)}px`,
              background: d.value > 0 ? color : "var(--border-subtle)",
            }}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, title: d.title ?? d.label, rows: [{ k: "value", v: String(d.value), color }] })}
            onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
            onMouseLeave={() => setTip(null)}
          />
          <span className="barmini-lbl">{d.label}</span>
        </div>
      ))}
      {tip && <ChartTooltip tip={tip} />}
    </div>
  );
}

interface Day { date: string; total: number; errors: number }
export function AreaChart({ days, h = 200 }: { days: Day[]; h?: number }) {
  const [tip, setTip] = useState<TipState | null>(null);
  if (!days.length) return <svg viewBox={`0 0 720 ${h}`} width={720} height={h} className="area" />;
  const w = 720, padL = 34, padB = 22, padT = 10;
  const innerW = w - padL, innerH = h - padB - padT;
  const max = Math.max(1, ...days.map((d) => d.total));
  const n = days.length;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const totalLine = line(days.map((d) => d.total));
  const totalArea = `${totalLine} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const errLine = line(days.map((d) => d.errors));
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} className="area" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ac-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--blue)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--blue)" stopOpacity="0" /></linearGradient>
        </defs>
        {grid.map((g) => (
          <g key={g}>
            <line x1={padL} x2={w} y1={y(max * g)} y2={y(max * g)} stroke="var(--border-subtle)" strokeWidth="1" />
            <text x={padL - 8} y={y(max * g) + 3} textAnchor="end" className="ax">{Math.round(max * g)}</text>
          </g>
        ))}
        <path d={totalArea} fill="url(#ac-fill)" />
        <path d={totalLine} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={errLine} fill="none" stroke="var(--rose)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
        {days.map((d, i) => (
          <g key={d.date}>
            <circle cx={x(i)} cy={y(d.total)} r="2.4" fill="var(--blue)" />
            <rect
              x={x(i) - 12} y={padT} width="24" height={innerH} fill="transparent"
              onMouseEnter={(e) => setTip({
                x: e.clientX, y: e.clientY, title: d.date,
                rows: [
                  { k: "runs", v: d.total.toLocaleString(), color: "var(--blue)" },
                  { k: "errors", v: d.errors.toLocaleString(), color: d.errors > 0 ? "var(--rose)" : undefined },
                ],
              })}
              onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
              onMouseLeave={() => setTip(null)}
            />
            {(i % 2 === 0 || i === n - 1) && <text x={x(i)} y={h - 6} textAnchor="middle" className="ax">{Number(d.date.slice(8, 10))}</text>}
          </g>
        ))}
      </svg>
      {tip && <ChartTooltip tip={tip} />}
    </>
  );
}

export function Donut({ segments, size = 132 }: { segments: { value: number; color: string; label: string }[]; size?: number }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const stroke = 16, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));

  // Each arc starts where the previous one ended, so precompute the running
  // offsets up front rather than mutating an accumulator inside the map. Same
  // geometry, but render stays a pure function of props.
  const arcs = segments.reduce<{ seg: (typeof segments)[number]; len: number; off: number }[]>(
    (acc, seg) => {
      const prev = acc[acc.length - 1];
      const off = prev ? prev.off + prev.len : 0;
      return [...acc, { seg, len: (seg.value / total) * c, off }];
    },
    []
  );

  return (
    <>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="donut">
        {arcs.map(({ seg, len, off }, i) => (
          <circle
            key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`}
            onMouseEnter={(e) => setTip({
              x: e.clientX, y: e.clientY, title: seg.label,
              rows: [
                { k: "count", v: seg.value.toLocaleString(), color: seg.color },
                { k: "share", v: `${Math.round((seg.value / total) * 100)}%` },
              ],
            })}
            onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
            onMouseLeave={() => setTip(null)}
          />
        ))}
        <text x="50%" y="47%" textAnchor="middle" className="donut-v" fill="var(--text-primary)">{total.toLocaleString()}</text>
        <text x="50%" y="61%" textAnchor="middle" className="donut-l" fill="var(--text-muted)">runs</text>
      </svg>
      {tip && <ChartTooltip tip={tip} />}
    </>
  );
}
