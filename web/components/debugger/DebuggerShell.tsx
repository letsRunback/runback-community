"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TraceEvent } from "@runback/schema";
import type { RunRow } from "@/lib/runs";
import RunHeader from "./RunHeader";
import Timeline from "./Timeline";
import StepInspector from "./StepInspector";
import TimeTravel from "./TimeTravel";
import DebuggerOnboarding from "./DebuggerOnboarding";

export default function DebuggerShell({
  run,
  events,
  cassetteDigest,
  embedded,
}: {
  run: RunRow;
  events: TraceEvent[];
  cassetteDigest?: string;
  /**
   * True when this shell is embedded mid-page (e.g. /app/runs/[run_id]),
   * surrounded by other sections above and below, instead of being the
   * page's sole content (the standalone /runs/[run_id] view). `.shell`'s
   * `height: 100vh` only makes sense for the standalone case — reused as-is
   * in the embedded case, the inner scroll panes get a height budget that
   * doesn't match what's actually visible, so their real overflow content
   * (e.g. the Replay tab's action button) becomes unreachable by normal
   * mouse-wheel scroll. `.shell--embedded` gives it a bounded height instead.
   */
  embedded?: boolean;
}) {
  // tool_call_id → the LLM span that requested it (the causal link).
  const requesterByToolCall = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) {
      if (e.type === "llm") {
        for (const tc of e.response.tool_calls) m.set(tc.tool_call_id, e.span_id);
      }
    }
    return m;
  }, [events]);

  // LLM span → the tool spans it spawned (reverse of the above).
  const toolsByRequester = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of events) {
      if (e.type === "tool") {
        const reqId = requesterByToolCall.get(e.tool_call_id);
        if (reqId) {
          const arr = m.get(reqId) ?? [];
          arr.push(e.span_id);
          m.set(reqId, arr);
        }
      }
    }
    return m;
  }, [events, requesterByToolCall]);

  const byId = useMemo(() => {
    const m = new Map<string, TraceEvent>();
    for (const e of events) m.set(e.span_id, e);
    return m;
  }, [events]);

  // Default selection: error-first (jump to where it broke), else first LLM call.
  const initialSpanId = useMemo(() => {
    const firstError = events.find(
      (e) =>
        (e.type === "llm" || e.type === "tool" || e.type === "run") && !!e.error
    );
    if (firstError) return firstError.span_id;
    const firstLlm = events.find((e) => e.type === "llm");
    return (firstLlm ?? events[0])?.span_id ?? null;
  }, [events]);

  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(
    initialSpanId
  );
  const [mode, setMode] = useState<"inspect" | "timetravel">("timetravel");

  const select = useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
  }, []);

  // Keep the selected row in view (covers error auto-focus + keyboard nav).
  useEffect(() => {
    if (!selectedSpanId) return;
    const el = document.getElementById(`row-${selectedSpanId}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedSpanId]);

  // j/k (and arrows) move through the timeline — DevTools muscle memory.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const i = events.findIndex((e) => e.span_id === selectedSpanId);
      if (ev.key === "j" || ev.key === "ArrowDown") {
        ev.preventDefault();
        const next = events[Math.min(events.length - 1, i + 1)];
        if (next) setSelectedSpanId(next.span_id);
      } else if (ev.key === "k" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const prev = events[Math.max(0, i - 1)];
        if (prev) setSelectedSpanId(prev.span_id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [events, selectedSpanId]);

  const selected = selectedSpanId ? byId.get(selectedSpanId) ?? null : null;

  // Cross-highlight: the causal counterpart(s) of the selected span.
  const relatedSpanIds = useMemo(() => {
    const s = new Set<string>();
    if (!selected) return s;
    if (selected.type === "tool") {
      const req = requesterByToolCall.get(selected.tool_call_id);
      if (req) s.add(req);
    } else if (selected.type === "llm") {
      for (const id of toolsByRequester.get(selected.span_id) ?? []) s.add(id);
    }
    return s;
  }, [selected, requesterByToolCall, toolsByRequester]);

  const requesterSpanId =
    selected?.type === "tool"
      ? requesterByToolCall.get(selected.tool_call_id) ?? null
      : null;

  return (
    <div className={embedded ? "shell shell--embedded" : "shell"}>
      <DebuggerOnboarding />
      <RunHeader run={run} events={events} mode={mode} embedded={embedded} />
      <div className="shell-modebar">
        <button className="shell-modebtn" data-active={mode === "inspect"} onClick={() => setMode("inspect")}>
          Inspect
        </button>
        <button className="shell-modebtn" data-active={mode === "timetravel"} onClick={() => setMode("timetravel")}>
          ⏱ Time travel
        </button>
      </div>
      {mode === "inspect" ? (
        <div className="shell-body">
          <Timeline
            events={events}
            selectedSpanId={selectedSpanId}
            relatedSpanIds={relatedSpanIds}
            onSelect={select}
          />
          <StepInspector
            event={selected}
            requesterSpanId={requesterSpanId}
            onJumpToSpan={select}
            datasetBasePath={embedded ? "/app/datasets" : "/datasets"}
          />
        </div>
      ) : (
        <div className="shell-tt">
          <TimeTravel run={run} events={events} cassetteDigest={cassetteDigest} />
        </div>
      )}
      <div style={{ padding: "0.5rem 1rem", borderTop: "1px solid var(--border-subtle)", display: "flex", gap: "1rem", alignItems: "center" }}>
        {/*
          Relative, not a hardcoded https://runback.dev — this shell is only
          ever rendered live inside this Next.js app (both the authenticated
          /app/runs/[run_id] view and the public /runs/[run_id] demo), never
          baked into a static export, so a relative link always resolves to
          the current deployment's own origin. On a self-hosted instance the
          old absolute links sent an admin verifying an audit record out to
          Runback's hosted SaaS instead of this instance's own /spec and
          /verify pages (both of which survive proxy.ts's self-host gate and
          work fully offline) — the opposite of what "verify this record"
          should do for an air-gapped deployment.
        */}
        <a href="/" target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: "0.72rem", color: "var(--text-muted)", textDecoration: "none" }}>Runback</a>
        <span style={{ color: "var(--border)" }}>·</span>
        <a href="/spec" target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: "0.72rem", color: "var(--text-muted)", textDecoration: "none" }}>runback.cassette/v1</a>
        <span style={{ color: "var(--border)" }}>·</span>
        <a href="/verify" target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: "0.72rem", color: "var(--text-muted)", textDecoration: "none" }}>verify this record →</a>
      </div>
    </div>
  );
}
