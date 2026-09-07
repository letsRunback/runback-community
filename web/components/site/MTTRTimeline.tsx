"use client";

import { useEffect, useRef, useState } from "react";

const OLD_WAY = [
  { t: "02:47", label: "Agent fails in production", note: "wrong tool called — logs say nothing useful" },
  { t: "03:12", label: "Engineer paged and woken up", note: "25 minutes of alert noise before escalation" },
  { t: "03:14", label: "Starts reading logs", note: "2,400 lines across 6 services — no context, no thread" },
  { t: "04:20", label: "Still in the logs", note: "which call? which step? which message did the model see?" },
  { t: "05:31", label: "Maybe reproduced locally", note: "different model version — not sure it's the same bug" },
  { t: "06:35", label: "Fix shipped — crossed fingers", note: "MTTR: 3h 48m · confidence: unknown", fin: true },
];

const WITH_RUNBACK = [
  { t: "02:47", label: "Agent fails → run captured", note: "automatic, zero config" },
  { t: "02:47", label: "Runback opens on the failed step", note: "error-first navigation — no hunting" },
  { t: "02:49", label: "Root cause identified", note: "Context tab shows the exact messages[] the model saw" },
  { t: "02:51", label: "Fix replayed — confirms it holds", note: "re-ran from step 3 with the patch, same environment" },
  { t: "02:51", label: "Incident → golden test in 1 click", note: "permanently in the regression suite" },
  { t: "02:51", label: "MTTR: 4 minutes 23 seconds", note: "fix verified · fix confirmed · audit record sealed", fin: true },
];

export default function MTTRTimeline() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const total = Math.max(OLD_WAY.length, WITH_RUNBACK.length);

  const run = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(0);
    setRunning(true);
    for (let i = 1; i <= total; i++) {
      timers.current.push(
        setTimeout(() => {
          setStep(i);
          if (i === total) setRunning(false);
        }, 300 + i * 820)
      );
    }
  };

  useEffect(() => {
    const t = setTimeout(run, 500);
    return () => {
      clearTimeout(t);
      timers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mttr">
      <div className="mttr-cols">
        <div className="mttr-col mttr-dim">
          <div className="mttr-col-h mono">Without Runback</div>
          {OLD_WAY.map((e, i) => (
            <div
              key={i}
              className="mttr-row"
              data-on={i < step || undefined}
              data-fin={e.fin || undefined}
            >
              <span className="mttr-t mono">{e.t}</span>
              <div className="mttr-entry">
                <div className="mttr-label">{e.label}</div>
                <div className="mttr-note mono">{e.note}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mttr-col mttr-bright">
          <div className="mttr-col-h mono">With Runback</div>
          {WITH_RUNBACK.map((e, i) => (
            <div
              key={i}
              className="mttr-row"
              data-on={i < step || undefined}
              data-fin={e.fin || undefined}
            >
              <span className="mttr-t mono">{e.t}</span>
              <div className="mttr-entry">
                <div className="mttr-label">{e.label}</div>
                <div className="mttr-note mono">{e.note}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mttr-foot">
        <button className="demo-rerun" onClick={run} disabled={running}>
          ↻ replay
        </button>
        <span className="mttr-disc mono">
          illustrative — based on common production patterns
        </span>
      </div>
    </div>
  );
}
