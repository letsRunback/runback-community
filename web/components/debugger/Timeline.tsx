"use client";

import { useMemo } from "react";
import type { TraceEvent } from "@runback/schema";
import { stepCaption } from "@/lib/narrative";

export interface TimelineProps {
  events: TraceEvent[];
  selectedSpanId: string | null;
  relatedSpanIds: Set<string>;
  onSelect: (spanId: string) => void;
}

function depthOf(
  e: TraceEvent,
  byId: Map<string, TraceEvent>
): number {
  let d = 0;
  let cur: TraceEvent | undefined = e;
  const seen = new Set<string>();
  while (cur && cur.parent_span_id && !seen.has(cur.span_id)) {
    seen.add(cur.span_id);
    const parent = byId.get(cur.parent_span_id);
    if (!parent) break;
    d++;
    cur = parent;
  }
  return d;
}

function glyph(e: TraceEvent): string {
  switch (e.type) {
    case "run":
      return "◆";
    case "llm":
      return "●";
    case "tool":
      return "→";
    case "reasoning":
      return "❝";
    case "env":
      return "·";
  }
}

function label(e: TraceEvent): string {
  switch (e.type) {
    case "run":
      return e.phase === "start" ? `run started` : `run ended`;
    case "llm":
      return e.model.model_id;
    case "tool":
      return e.tool_name;
    case "reasoning":
      // A graph node's own name/identity — when the source reports it — reads
      // better in the timeline than the generic span-kind label every
      // CHAIN/AGENT-kind step otherwise collapses to (see mapper.ts).
      return e.graph_node?.name ?? e.label ?? "reasoning";
    case "env":
      return e.kind;
  }
}

function hasError(e: TraceEvent): boolean {
  return (e.type === "llm" || e.type === "tool" || e.type === "run") && !!e.error;
}

/** A runtime policy guardrail blocked this action before it ran. */
function isBlocked(e: TraceEvent): boolean {
  return e.type === "tool" && !!e.policy_block;
}

function maxLatency(events: TraceEvent[]): number {
  return Math.max(
    1,
    ...events.map((e) =>
      (e.type === "llm" || e.type === "tool") && e.latency_ms ? e.latency_ms : 0
    )
  );
}

export default function Timeline({
  events,
  selectedSpanId,
  relatedSpanIds,
  onSelect,
}: TimelineProps) {
  const byId = useMemo(() => {
    const m = new Map<string, TraceEvent>();
    for (const e of events) m.set(e.span_id, e);
    return m;
  }, [events]);
  const maxLat = useMemo(() => maxLatency(events), [events]);

  return (
    <nav className="pane pane-timeline" aria-label="Run timeline">
      {events.map((e) => {
        const d = depthOf(e, byId);
        const blocked = isBlocked(e);
        const err = hasError(e) && !blocked; // a block is its own state, not a failure
        const selected = e.span_id === selectedSpanId;
        const related = relatedSpanIds.has(e.span_id) && !selected;
        const lat =
          (e.type === "llm" || e.type === "tool") && e.latency_ms
            ? e.latency_ms
            : 0;
        const tokens = e.type === "llm" ? e.usage?.total_tokens ?? null : null;
        const caption = stepCaption(e);

        return (
          <button
            key={e.span_id}
            id={`row-${e.span_id}`}
            className="tl-row"
            data-selected={selected}
            data-error={err}
            data-blocked={blocked}
            data-related={related}
            onClick={() => onSelect(e.span_id)}
          >
            <span className="tl-glyph">{blocked ? "⊘" : glyph(e)}</span>
            <span style={{ minWidth: 0 }}>
              <span className="tl-label" style={{ display: "block" }}>
                <span
                  className="tl-indent"
                  style={{ width: d * 12 }}
                  aria-hidden
                />
                {label(e)}
                {blocked && <span className="tl-block-badge">blocked</span>}
                {err && (
                  <span style={{ color: "var(--rose)" }}> ✗</span>
                )}
              </span>
              {caption && <span className="tl-caption">{caption}</span>}
              {(e.type === "llm" || e.type === "tool") && lat > 0 && (
                <span className="tl-bar-track" style={{ display: "block" }}>
                  <span
                    className="tl-bar-fill"
                    data-kind={err ? "error" : e.type}
                    style={{
                      display: "block",
                      width: `${Math.max(4, (lat / maxLat) * 100)}%`,
                    }}
                  />
                </span>
              )}
            </span>
            <span className="tl-meta">
              {tokens != null
                ? `${tokens} tok`
                : lat > 0
                  ? `${lat} ms`
                  : ""}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
