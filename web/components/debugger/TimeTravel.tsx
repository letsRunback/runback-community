"use client";

import { useEffect, useMemo, useState } from "react";
import type { TraceEvent } from "@runback/schema";
import type { RunRow } from "@/lib/runs";
import { buildFrames } from "@/lib/replay/timeTravel";

/**
 * Time-travel player. 100% client-side, offline-safe: it reconstructs every
 * frame from the events already on the page — no fetch, no model calls, nothing
 * leaves the machine. Works air-gapped in a client's own premises.
 */
export default function TimeTravel({
  run,
  events,
  cassetteDigest,
}: {
  run: RunRow;
  events: TraceEvent[];
  cassetteDigest?: string;
}) {
  const frames = useMemo(() => buildFrames(run, events), [run, events]);

  // Open on the failing step (rewound to where it broke), else the end.
  const failIndex = useMemo(() => {
    const stepFail = frames.findIndex((f) => f.isFailure && f.kind !== "run");
    return stepFail >= 0 ? stepFail : frames.length - 1;
  }, [frames]);
  const [pos, setPos] = useState(failIndex);
  const frame = frames[Math.min(pos, frames.length - 1)];

  const step = (d: number) => setPos((p) => Math.max(0, Math.min(frames.length - 1, p + d)));

  // ◀ ▶ to scrub; Home/End to jump.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "Home") { e.preventDefault(); setPos(0); }
      else if (e.key === "End") { e.preventDefault(); setPos(frames.length - 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames.length]);

  const failPct = frames.length > 1 ? (failIndex / (frames.length - 1)) * 100 : 0;

  return (
    <div className="tt">
      <div className="tt-bar">
        <div className="tt-bar-l">
          <span className="tt-title">Time-travel replay</span>
          <span className="tt-badge mono">deterministic · offline · no model calls</span>
          {cassetteDigest && (
            <a
              className="tt-cassette mono"
              href={`/api/runs/${run.run_id}/audit`}
              download={`runback-audit-${run.run_id}.json`}
              title="The run's deterministic oracle-stream digest. Download the signed audit record to verify it reproduces."
            >
              ⛓ cassette {cassetteDigest.slice(0, 12)}…
            </a>
          )}
        </div>
        <span className="tt-frame mono">frame {pos + 1} / {frames.length}</span>
      </div>
      <p className="tt-hint">Scrub the run — rewind to before it broke and watch what the agent knew at each step. Reconstructed from the recording; nothing leaves this machine.</p>

      <div className="tt-scrub">
        <button className="tt-btn" onClick={() => setPos(0)} title="Start (Home)">⏮</button>
        <button className="tt-btn" onClick={() => step(-1)} title="Back (←)">◀</button>
        <div className="tt-track">
          {failIndex < frames.length - 1 && (
            <span className="tt-failmark" style={{ left: `${failPct}%` }} title="failure" />
          )}
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            className="tt-range"
            aria-label="Run timeline"
            // The control is 0-indexed and the visible label is 1-indexed,
            // which is right for both audiences but means a screen reader
            // announced "4" while the screen said "frame 5 / 6". Say the same
            // thing the sighted user is reading.
            aria-valuetext={`frame ${pos + 1} of ${frames.length}`}
          />
        </div>
        <button className="tt-btn" onClick={() => step(1)} title="Forward (→)">▶</button>
        <button className="tt-btn" onClick={() => setPos(frames.length - 1)} title="End (End)">⏭</button>
      </div>

      <div className="tt-body">
        {/* The conversation, reconstructed up to this frame */}
        <div className="tt-transcript">
          {frame.transcript.map((m, i) => (
            <button
              key={i}
              type="button"
              className="tt-msg"
              data-role={m.role}
              data-tone={m.tone}
              data-latest={i === frame.transcript.length - 1}
              data-current={m.frameIndex === pos}
              onClick={() => setPos(m.frameIndex)}
              title={`Jump to frame ${m.frameIndex + 1}`}
            >
              <span className="tt-role mono">{m.label}</span>
              <div className="tt-msg-body">{m.body}</div>
            </button>
          ))}
        </div>

        {/* State at this frame */}
        <aside className="tt-state">
          <div className="tt-step" data-fail={frame.isFailure}>
            <div className="tt-step-kind mono">{frame.kind}</div>
            <div className="tt-step-title">{frame.title}</div>
            {frame.detail.rows.length > 0 && (
              <dl className="tt-kv">
                {frame.detail.rows.map((r) => (
                  <div className="tt-kvrow" key={r.k}>
                    <dt className="mono">{r.k}</dt>
                    <dd className="mono">{r.v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {frame.detail.error && <div className="tt-err">{frame.detail.error}</div>}
          </div>

          <div className="tt-counters">
            <div className="tt-counter"><span className="v mono">{frame.cumTokens.toLocaleString()}</span><span className="l">tokens so far</span></div>
            <div className="tt-counter"><span className="v mono">${frame.cumCostUsd.toFixed(4)}</span><span className="l">est. cost</span></div>
            <div className="tt-counter"><span className="v mono">{(frame.cumLatencyMs / 1000).toFixed(2)}s</span><span className="l">elapsed</span></div>
            <div className="tt-counter"><span className="v mono">{frame.toolsCalled.length}</span><span className="l">tools called</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
