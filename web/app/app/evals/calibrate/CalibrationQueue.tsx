"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Review {
  id: string;
  judge_passed: boolean;
  judge_score: number | null;
  judge_reason: string | null;
  output_snippet: string | null;
}

export default function CalibrationQueue({ reviews: initial }: { reviews: Review[] }) {
  const router = useRouter();
  const [reviews, setReviews] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function decide(review: Review, humanPassed: boolean) {
    setBusy(review.id);
    setError(null);
    try {
      const res = await fetch("/api/evals/calibrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ review_id: review.id, human_passed: humanPassed, human_note: notes[review.id] || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setReviews((prev) => prev.filter((r) => r.id !== review.id));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (reviews.length === 0) {
    return <div className="appc-empty">All caught up — nothing left pending for this rubric.</div>;
  }

  return (
    <ul className="eval-results">
      {reviews.map((r) => (
        <li key={r.id} className="eval-row">
          <div className="eval-row-top">
            <span className={`verdict ${r.judge_passed ? "pass" : "fail"}`}>{r.judge_passed ? "JUDGE: PASS" : "JUDGE: FAIL"}</span>
            {r.judge_score != null && <span className="mono appc-dim eval-latency">score {r.judge_score.toFixed(2)}</span>}
          </div>
          <div className="eval-row-out mono">{r.output_snippet || "(no output captured)"}</div>
          {r.judge_reason && <p className="appc-sub mono" style={{ marginTop: "0.3rem" }}>{r.judge_reason}</p>}
          <input
            value={notes[r.id] ?? ""}
            onChange={(e) => setNotes((s) => ({ ...s, [r.id]: e.target.value }))}
            placeholder="Note (optional) — why the judge was right or wrong"
            style={{ marginTop: "0.5rem", width: "100%", maxWidth: 480 }}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button className="btn-line" onClick={() => decide(r, r.judge_passed)} disabled={busy === r.id}>
              {busy === r.id ? "…" : "✓ Agree"}
            </button>
            <button className="btn-line" onClick={() => decide(r, !r.judge_passed)} disabled={busy === r.id}>
              {busy === r.id ? "…" : "✗ Correct"}
            </button>
          </div>
        </li>
      ))}
      {error && <li className="gs-error">{error}</li>}
    </ul>
  );
}
