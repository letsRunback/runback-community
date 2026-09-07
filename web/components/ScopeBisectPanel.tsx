"use client";

/**
 * The scope-bisect payoff, in the one place it's actually useful: next to a
 * delegation edge TrustChain.tsx already flagged as a scope violation.
 * "Which of these N scope grants between these two agents is the one that
 * let this through" — same BisectTrack visual as the model/prompt bisect
 * feature, same algorithm (packages/replay/src/enterprise/bisect.ts, unchanged),
 * different axis. See web/app/api/agents/scope-bisect/route.ts.
 */
import { useState } from "react";
import BisectTrack from "@/components/BisectTrack";

interface ScopeBisectResult {
  count: number;
  firstBadIndex: number | null;
  lastGoodIndex: number | null;
  probes: { index: number; good: boolean }[];
  comparisons: number;
  verdict: string;
  labels: string[];
  culprit: string | null;
  lastGood: string | null;
}

export function ScopeBisectPanel({ callingAgent, calledAgent }: { callingAgent: string; calledAgent: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<ScopeBisectResult | null>(null);
  const [revealed, setRevealed] = useState(0);

  async function run() {
    setOpen(true);
    setBusy(true);
    setErr("");
    setResult(null);
    setRevealed(0);
    try {
      const res = await fetch(
        `/api/agents/scope-bisect?calling_agent=${encodeURIComponent(callingAgent)}&called_agent=${encodeURIComponent(calledAgent)}`
      );
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Scope bisect failed."); setBusy(false); return; }
      setResult(data.result);
      setBusy(false);
      (data.result as ScopeBisectResult).probes.forEach((_, i: number) => {
        setTimeout(() => setRevealed((r) => Math.max(r, i + 1)), i * 400);
      });
    } catch {
      setErr("Network error.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="tc-scope-bisect-trigger mono" onClick={run}>
        which scope grant let this through? →
      </button>
    );
  }

  return (
    <div className="tc-scope-bisect">
      {busy && !result && <div className="bv-status mono">Bisecting scope history between {callingAgent} and {calledAgent}…</div>}
      {err && <p className="bisect-error">{err}</p>}
      {result && (
        <>
          <BisectTrack labels={result.labels} probes={result.probes} revealed={revealed} culpritIndex={result.firstBadIndex} />
          <div className="bv-status mono">
            {revealed < result.probes.length
              ? `probe #${revealed + 1} — checking ${result.labels[result.probes[revealed].index]}…`
              : result.verdict}
          </div>
        </>
      )}
    </div>
  );
}
