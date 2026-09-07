"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REPLAY_MODELS } from "@/lib/replay/models";

interface RunResult {
  total: number;
  mode: "integrity" | "candidate";
  model: string | null;
  ok: number;
  flagged: number;
  missing: number;
}

/**
 * POST /api/golden/run had no caller anywhere in the app — the page's own copy
 * promised "re-run the corpus on any candidate model before release" with no
 * button to do it.
 */
export default function RunSuiteButton({ deepReplayAllowed }: { deepReplayAllowed: boolean }) {
  const router = useRouter();
  const [model, setModel] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);

  async function run() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/golden/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(model ? { model } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setError(data.error || "Suite run failed."); return; }
      setResult(data.result);
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="golden-run-suite">
      <select
        className="settings-input golden-run-model"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        disabled={running}
      >
        <option value="">Integrity check (no model — free)</option>
        {deepReplayAllowed && REPLAY_MODELS.map((m) => (
          <option key={m} value={m}>Candidate: {m}</option>
        ))}
      </select>
      <button type="button" className="btn-line" onClick={run} disabled={running}>
        {running ? "Running…" : "Run the suite"}
      </button>
      {error && <span className="golden-err">{error}</span>}
      {result && (
        <span className="golden-run-result mono">
          {result.mode === "integrity" ? "Integrity" : `vs ${result.model}`}: {result.ok}/{result.total} ok
          {result.flagged > 0 && <span data-tone="rose"> · {result.flagged} flagged</span>}
          {result.missing > 0 && <span> · {result.missing} missing</span>}
        </span>
      )}
    </div>
  );
}
