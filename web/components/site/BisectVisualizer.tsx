"use client";

/**
 * The marketing-site demo for Bisect — runs the REAL @runback/replay
 * bisectCandidates() against a scripted candidate list (no backend, no auth,
 * works for an anonymous visitor), not a fake reimplementation. Draws the
 * search itself via BisectTrack — the same visual the product page uses —
 * instead of a list of pass/fail text rows.
 */
import { useState } from "react";
import { bisectCandidates, type BisectCandidatesOutcome } from "@runback/replay";
import BisectTrack from "@/components/BisectTrack";

const CANDIDATES = [
  "prompt v1", "prompt v2", "prompt v3", "prompt v4",
  "prompt v5", "prompt v6", "prompt v7", "prompt v8",
  "gpt-4o", "gpt-4o-0513", "gpt-4.1", "claude-sonnet-4-6",
];
// Everything from index 8 on ("gpt-4o" onward) regresses — a monotone
// good→bad transition, the one assumption bisect requires.
const BAD_FROM = 8;

export default function BisectVisualizer() {
  const [result, setResult] = useState<BisectCandidatesOutcome<string> | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setResult(null);
    setRevealed(0);
    const out = await bisectCandidates(
      CANDIDATES,
      (c) => c,
      (_c, i) => i < BAD_FROM
    );
    setResult(out);
    setRunning(false);
    out.probes.forEach((_, i) => {
      setTimeout(() => setRevealed((r) => Math.max(r, i + 1)), i * 700);
    });
  }

  const done = !!result && revealed >= result.probes.length;
  const current = result && !done ? result.probes[revealed] : null;

  return (
    <div className="bv-wrap">
      <BisectTrack
        labels={CANDIDATES}
        probes={result?.probes ?? []}
        revealed={revealed}
        culpritIndex={result?.firstBadIndex ?? null}
      />

      <div className="bv-status mono">
        {!result && "Ready — 12 candidates, one regression, unknown which."}
        {current && `probe #${revealed + 1} — testing ${current ? CANDIDATES[current.index] : ""}…`}
        {done && result!.verdict}
      </div>

      <button className="btn-fill bv-run" onClick={run} disabled={running}>
        {running || (result && !done) ? "Bisecting…" : result ? "Run it again →" : "Run the bisect →"}
      </button>
    </div>
  );
}
