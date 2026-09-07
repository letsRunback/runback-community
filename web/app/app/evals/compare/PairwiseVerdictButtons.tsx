"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Side = "a" | "b" | "tie";

export default function PairwiseVerdictButtons({
  evalRunAId,
  evalRunBId,
  itemId,
  current,
}: {
  evalRunAId: string;
  evalRunBId: string;
  itemId: string;
  current: Side | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Side | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function vote(winner: Side) {
    setBusy(winner);
    setError(null);
    try {
      const res = await fetch("/api/evals/pairwise/verdict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eval_run_a_id: evalRunAId, eval_run_b_id: evalRunBId, item_id: itemId, winner }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem", marginTop: "0.5rem" }}>
      <button className="btn-line" onClick={() => vote("a")} disabled={busy !== null} data-active={current === "a" || undefined}>
        {busy === "a" ? "…" : "A wins"}
      </button>
      <button className="btn-line" onClick={() => vote("tie")} disabled={busy !== null} data-active={current === "tie" || undefined}>
        {busy === "tie" ? "…" : "Tie"}
      </button>
      <button className="btn-line" onClick={() => vote("b")} disabled={busy !== null} data-active={current === "b" || undefined}>
        {busy === "b" ? "…" : "B wins"}
      </button>
      {error && <span style={{ color: "var(--rose)", fontSize: "0.8rem" }}>{error}</span>}
    </div>
  );
}
