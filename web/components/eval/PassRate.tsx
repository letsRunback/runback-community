/** A compact pass-rate bar + count. Pure (no client hooks). */
export default function PassRate({
  pass,
  total,
}: {
  pass: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((pass / total) * 100) : 0;
  const tone = total === 0 ? "muted" : pass === total ? "emerald" : pass === 0 ? "rose" : "amber";
  return (
    <div className="passrate" title={`${pass} of ${total} passed`}>
      <div className="passrate-bar">
        <div className="passrate-fill" data-tone={tone} style={{ width: `${pct}%` }} />
      </div>
      <span className="mono passrate-num" data-tone={tone}>
        {pass}/{total}
      </span>
    </div>
  );
}
