/**
 * The same incident resolved two ways: hours of log archaeology, or minutes
 * with the run open on the failing step.
 *
 * Recovered from /proof when that page merged into /how-it-works. It is the
 * single most persuasive thing on the site — a concrete before/after with real
 * timestamps — and was nearly lost in the consolidation. Kept as a component so
 * it can sit inside the mechanism narrative rather than needing a page of its own.
 */
const BEFORE_LOGS = [
  { t: "2:47 AM — alert fires" },
  { t: "3:00 AM — first engineer online" },
  { t: "4:15 AM — found a suspicious log line", warn: true },
  { t: "5:20 AM — maybe found the prompt issue?", warn: true },
  { t: "6:35 AM — fix deployed, fingers crossed", warn: true },
];

const AFTER_LOGS = [
  { t: "2:47 AM — alert fires with run link" },
  { t: "2:49 AM — run open, failure step highlighted" },
  { t: "2:51 AM — root cause found in messages[]", good: true },
  { t: "2:52 AM — fix applied, replay confirms", good: true },
  { t: "2:52 AM — sealed. Done.", good: true },
];

export default function IncidentCompare() {
  return (
    <div className="proof-compare">
      {/* Before */}
      <div className="proof-cmp-side proof-cmp-side-a">
        <div className="proof-cmp-label">Without Runback</div>
        <div className="proof-cmp-time" data-v="bad">3h 48m</div>
        <div className="proof-cmp-desc">
          Grep through 2,400 log lines.<br />
          Guess. Patch. Hope it doesn&apos;t recur.
        </div>
        <div className="proof-cmp-logs">
          {BEFORE_LOGS.map((s, i) => (
            <div key={i} className="proof-cmp-log" data-hl={s.warn ? "warn" : undefined}>
              <span className="proof-log-glyph">›</span>
              {s.t}
            </div>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="proof-cmp-sep">
        <div className="proof-cmp-sep-inner">
          <div className="proof-cmp-sep-arrow">→</div>
          <div className="proof-cmp-sep-label">same incident</div>
        </div>
      </div>

      {/* After */}
      <div className="proof-cmp-side">
        <div className="proof-cmp-label">With Runback</div>
        <div className="proof-cmp-time" data-v="good">4m 23s</div>
        <div className="proof-cmp-desc">
          Open the run. Root cause is highlighted.<br />
          Patch, replay to confirm, seal the record.
        </div>
        <div className="proof-cmp-logs">
          {AFTER_LOGS.map((s, i) => (
            <div key={i} className="proof-cmp-log" data-hl={s.good ? "good" : undefined}>
              <span className="proof-log-glyph" data-v="ok">✓</span>
              {s.t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}