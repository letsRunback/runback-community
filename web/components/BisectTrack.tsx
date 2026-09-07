"use client";

/**
 * The actual binary search, drawn — not described. A rail spanning every
 * candidate, a shrinking highlighted range that narrows toward the culprit
 * as each probe resolves, grid-aligned tick marks and labels underneath, and
 * a flag on the one that broke it. Shared by the product page
 * (/app/models/bisect) and the marketing demo (BisectVisualizer) — same
 * visual for the same algorithm.
 *
 * The shrinking box uses percentage left/width (CSS-transitionable) so it
 * visibly slides and narrows; everything else uses CSS grid columns keyed to
 * candidate index, so ticks/labels/markers stay pixel-aligned to the rail
 * without any percentage math of their own.
 */
export interface BisectTrackProps {
  labels: string[];
  probes: { index: number; good: boolean }[];
  /** How many probes (in order) to actually show — drives the reveal animation. */
  revealed: number;
  /** result.firstBadIndex — only meaningful once revealed >= probes.length. */
  culpritIndex: number | null;
}

export default function BisectTrack({ labels, probes, revealed, culpritIndex }: BisectTrackProps) {
  const count = labels.length;
  const shown = probes.slice(0, revealed);
  const done = revealed >= probes.length;

  // Replay the exact lo/hi bookkeeping bisect.ts itself uses: lo = one past
  // the last proven-good index; hi = the first proven-bad index (or count,
  // if none found yet). Every zone below is derived from these two numbers.
  let lo = 0;
  let hi = count;
  for (const p of shown) {
    if (p.good) lo = p.index + 1;
    else hi = p.index;
  }

  const goodPct = (lo / count) * 100;
  const activeLeftPct = (lo / count) * 100;
  const activeWidthPct = ((hi - lo) / count) * 100;
  const badPct = (hi / count) * 100;

  return (
    <div className="bt" style={{ "--bt-n": count } as React.CSSProperties}>
      <div className="bt-rail">
        {goodPct > 0 && <div className="bt-zone bt-zone-good" style={{ width: `${goodPct}%` }} />}
        {badPct < 100 && <div className="bt-zone bt-zone-bad" style={{ left: `${badPct}%`, width: `${100 - badPct}%` }} />}
        {!done && activeWidthPct > 0 && (
          <div className="bt-active" style={{ left: `${activeLeftPct}%`, width: `${activeWidthPct}%` }} />
        )}
        {done && culpritIndex !== null && (
          <div className="bt-flag" style={{ left: `${(culpritIndex / count) * 100}%` }} title={labels[culpritIndex]}>
            <span className="bt-flag-pole" />
            <span className="bt-flag-mark">⚑</span>
          </div>
        )}
        <div className="bt-markers">
          {shown.map((p, i) => (
            <div
              key={i}
              className="bt-marker"
              data-good={p.good || undefined}
              style={{ left: `${((p.index + 0.5) / count) * 100}%`, animationDelay: `${i * 0.05}s` }}
              title={`probe #${i + 1} — ${labels[p.index]} — ${p.good ? "good" : "bad"}`}
            />
          ))}
        </div>
      </div>

      <div className="bt-ticks">
        {labels.map((_, i) => <div key={i} className="bt-tick" />)}
      </div>
      <div className="bt-labels">
        {labels.map((l, i) => {
          const p = shown.find((x) => x.index === i);
          return (
            <div key={l} className="bt-label mono" data-state={p ? (p.good ? "good" : "bad") : undefined}>
              {l}
            </div>
          );
        })}
      </div>
    </div>
  );
}
