"use client";

import Link from "next/link";
import { useState } from "react";
import type { TraceEvent } from "@runback/schema";
import type { RunRow } from "@/lib/runs";
import { runSummary } from "@/lib/narrative";

/** Top bar: run identity, status, aggregate stats, a sparkline, and a help legend. */
export default function RunHeader({
  run,
  events,
  mode,
  embedded,
}: {
  run: RunRow;
  events: TraceEvent[];
  /** Which pane the shell is showing — the help popover's content differs per mode
      (Inspect has Context/Response/Replay tabs; Time travel has a scrubber). */
  mode: "inspect" | "timetravel";
  /** True inside the authenticated app shell (/app/runs/[run_id]) — the back
      link must stay inside the app (/app/runs), not drop to the public,
      logged-out marketing demo-runs page (/runs). */
  embedded?: boolean;
}) {
  const [help, setHelp] = useState(false);
  const llm = events.filter((e) => e.type === "llm");
  const wallMs =
    run.ended_at && run.started_at
      ? new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()
      : null;

  const maxLatency = Math.max(
    1,
    ...llm.map((e) => (e.type === "llm" ? e.latency_ms ?? 0 : 0))
  );
  const summary = runSummary(run, events);

  return (
    <header className="runhdr">
      <Link href={embedded ? "/app/runs" : "/runs"} className="mono" style={{ fontSize: "0.75rem" }} title="All runs">
        ←
      </Link>
      <div className="rh-title">
        <div className="rh-title-row">
          <span className="rh-name">{run.name}</span>
          <span className={`pill pill-${run.status}`}>{run.status}</span>
          {run.actor_type && (
            <span className="rh-actor mono" title={`Reported by the SDK — CollectorOptions.actor`}>
              {run.actor_type}{run.actor_id ? `:${run.actor_id}` : ""}
            </span>
          )}
        </div>
        <div className="rh-summary" data-tone={summary.tone}>
          {summary.line}
        </div>
      </div>

      <div className="rh-stat">
        <span className="v">{run.step_count}</span>
        <span className="l">steps</span>
      </div>
      <div className="rh-stat">
        <span className="v">{run.total_tokens.toLocaleString()}</span>
        <span className="l">tokens</span>
      </div>
      <div className="rh-stat">
        <span className="v">{wallMs != null ? `${(wallMs / 1000).toFixed(1)}s` : "—"}</span>
        <span className="l">wall</span>
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.85rem" }}>
        <div className="spark" title="Model latency per step">
          {llm.map((e) => {
            const lat = e.type === "llm" ? e.latency_ms ?? 0 : 0;
            const isErr = e.type === "llm" && !!e.error;
            const h = Math.max(3, Math.round((lat / maxLatency) * 26));
            return (
              <div
                key={e.span_id}
                className="spark-bar"
                data-error={isErr}
                style={{ height: h }}
                title={`${lat} ms`}
              />
            );
          })}
        </div>

        <a
          className="rh-export"
          href={`/api/runs/${run.run_id}/audit`}
          download={`runback-audit-${run.run_id}.json`}
          title="Download a tamper-evident audit record of this run"
        >
          ⤓ Audit record
        </a>

        <div style={{ position: "relative" }}>
          <button
            className="rh-help"
            onClick={() => setHelp((h) => !h)}
            data-open={help}
            aria-label="What am I looking at?"
          >
            ?
          </button>
          {help && (
            <>
              <div className="rh-help-scrim" onClick={() => setHelp(false)} />
              <div className="rh-help-pop" role="dialog">
                {mode === "inspect" ? (
                  <>
                    <div className="rh-help-title">What am I looking at?</div>
                    <p className="rh-help-p">
                      Each row on the left is one step the agent took. Select a step
                      to inspect it on the right.
                    </p>
                    <div className="rh-legend">
                      <div><span style={{ color: "var(--blue)" }}>●</span> the agent thinks (model call)</div>
                      <div><span style={{ color: "var(--violet)" }}>→</span> the agent acts (tool runs)</div>
                      <div><span style={{ color: "var(--rose)" }}>✗</span> a step failed</div>
                      <div><span style={{ color: "var(--emerald)" }}>✓</span> a step succeeded</div>
                    </div>
                    <div className="rh-help-title" style={{ marginTop: "0.85rem" }}>The tabs</div>
                    <div className="rh-legend">
                      <div><b>Context</b> — what the model saw</div>
                      <div><b>Response</b> — what it decided</div>
                      <div><b>Replay</b> — re-run that step, even edited</div>
                    </div>
                    <div className="rh-help-foot">
                      <kbd className="key">j</kbd> <kbd className="key">k</kbd> move between steps ·{" "}
                      <Link href="/how-it-works" style={{ color: "var(--blue)" }}>
                        Full guide →
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rh-help-title">What am I looking at?</div>
                    <p className="rh-help-p">
                      A frame-by-frame replay of the run, reconstructed purely from the
                      recording — nothing leaves this machine. The left panel is the
                      conversation as it had unfolded up to this point; the right panel
                      is the agent&apos;s state at this exact frame.
                    </p>
                    <div className="rh-legend">
                      <div>Drag the scrubber, or use ◀ ▶, to move frame by frame</div>
                      <div>Click any message on the left to jump straight to its frame</div>
                      <div><span style={{ color: "var(--rose)" }}>▲</span> marks where the run failed on the timeline</div>
                    </div>
                    <div className="rh-help-foot">
                      <kbd className="key">←</kbd> <kbd className="key">→</kbd> scrub ·{" "}
                      <kbd className="key">Home</kbd> <kbd className="key">End</kbd> jump to start/end ·{" "}
                      <Link href="/how-it-works" style={{ color: "var(--blue)" }}>
                        Full guide →
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
