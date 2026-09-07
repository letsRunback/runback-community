"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RunPairwiseButton({
  evalRunAId,
  evalRunBId,
}: {
  evalRunAId: string;
  evalRunBId: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ judged: number; skipped: number; failed: number } | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/evals/pairwise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eval_run_a_id: evalRunAId, eval_run_b_id: evalRunBId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setResult({ judged: data.judged, skipped: data.skipped, failed: data.failed ?? 0 });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", margin: "0.75rem 0" }}>
      <button className="replay-btn" onClick={run} disabled={running}>
        {running ? "Judging…" : "Judge all with AI ▸"}
      </button>
      {result && (
        <span className="mono appc-dim">
          {result.judged} judged{result.skipped ? `, ${result.skipped} already done` : ""}
          {result.failed > 0 && <span style={{ color: "var(--rose)" }}> · {result.failed} couldn&apos;t be judged (no working model key?) — try again</span>}
        </span>
      )}
      {error && <span style={{ color: "var(--rose)", fontSize: "0.8rem" }}>{error}</span>}
    </div>
  );
}
