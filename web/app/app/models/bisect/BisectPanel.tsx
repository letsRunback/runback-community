"use client";

import { useState } from "react";
import BisectTrack from "@/components/BisectTrack";

/**
 * Client half of /app/models/bisect — the API (bisectStoredRun, backed by
 * packages/replay/src/enterprise/bisect.ts) already did the real work; this just gives
 * it the interface git-bisect users already have muscle memory for, and
 * draws the search itself (BisectTrack) — the actual proof of how the
 * culprit was found, not just the verdict — instead of burying it in a
 * JSON response or a flat list of pass/fail rows.
 */

export interface BisectRunOption {
  run_id: string;
  name: string;
}

export interface BisectResult {
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

export default function BisectPanel({
  runs,
  defaultCandidates,
  defaultRunId,
}: {
  runs: BisectRunOption[];
  defaultCandidates: string[];
  defaultRunId?: string;
}) {
  const [runId, setRunId] = useState(defaultRunId ?? runs[0]?.run_id ?? "");
  const [candidates, setCandidates] = useState<string[]>(defaultCandidates);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<BisectResult | null>(null);
  const [revealed, setRevealed] = useState(0); // how many probes are animated in so far

  function toggle(c: string) {
    setCandidates((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  }

  async function start() {
    if (!runId || candidates.length < 2) return;
    setBusy(true); setErr(""); setResult(null); setRevealed(0);
    try {
      const res = await fetch(`/api/runs/${runId}/bisect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidates }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Bisect failed."); setBusy(false); return; }
      setResult(data.result);
      setBusy(false);
      // Reveal probes one at a time — the same "watch it converge" moment
      // `git bisect` gives you interactively, instead of dumping the whole
      // log at once.
      data.result.probes.forEach((_: unknown, i: number) => {
        setTimeout(() => setRevealed((r) => Math.max(r, i + 1)), i * 550);
      });
    } catch {
      setErr("Network error.");
      setBusy(false);
    }
  }

  return (
    <div className="bisect-panel">
      <div className="md-form">
        <div className="md-field">
          <label className="md-label">Run</label>
          <select className="md-select" value={runId} onChange={(e) => setRunId(e.target.value)} disabled={busy}>
            {runs.length === 0 && <option value="">No runs yet</option>}
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>{r.name} · {r.run_id.slice(0, 10)}</option>
            ))}
          </select>
        </div>
        <button className="btn-fill md-submit" onClick={start} disabled={busy || !runId || candidates.length < 2}>
          {busy ? "Bisecting…" : "Start bisect →"}
        </button>
      </div>

      <div className="bisect-candidates">
        <span className="md-label bisect-candidates-label">Candidates — good → bad, in order</span>
        <div className="bisect-candidate-chips">
          {defaultCandidates.map((c) => (
            <button
              key={c}
              type="button"
              className="bisect-chip"
              data-on={candidates.includes(c) || undefined}
              onClick={() => toggle(c)}
              disabled={busy}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="bisect-error">{err}</p>}

      {result && (
        <div className="bisect-result">
          <BisectTrack
            labels={result.labels}
            probes={result.probes}
            revealed={revealed}
            culpritIndex={result.firstBadIndex}
          />

          <div className="bv-status mono">
            {revealed < result.probes.length && `probe #${revealed + 1} — testing ${result.labels[result.probes[revealed].index]}…`}
          </div>

          {revealed >= result.probes.length && (
            <div className="bisect-verdict" data-found={result.firstBadIndex !== null || undefined}>
              <p className="bisect-verdict-text">{result.verdict}</p>
              {result.culprit && (
                <p className="bisect-culprit mono">
                  culprit → <strong>{result.culprit}</strong>
                  {result.lastGood && <> · last good → <strong>{result.lastGood}</strong></>}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
