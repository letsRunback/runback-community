"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SyntheticItemView {
  id: string;
  label: string | null;
  approval_status: "pending" | "approved" | "rejected" | null;
  generated_rationale: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * Generate LLM-proposed adversarial scenarios for a dataset, and review the
 * ones already proposed. A pending scenario has been scored (if an eval has
 * run since) but never counts toward a release-gate decision until approved
 * here — see web/lib/eval/adversarial.ts for why.
 */
export default function AdversarialPanel({
  datasetId,
  syntheticItems,
}: {
  datasetId: string;
  syntheticItems: SyntheticItemView[];
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/datasets/${datasetId}/adversarial`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 5 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function review(itemId: string, decision: "approved" | "rejected") {
    setReviewingId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/datasets/${datasetId}/items/${itemId}/review`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <section className="ds-eval-section">
      <div className="dash-panel-h">Adversarial scenarios</div>
      <p className="appc-sub" style={{ marginTop: 0 }}>
        LLM-proposed test cases. Each is scored by the same runner and independent judge as
        production-captured items, but never counts toward a release-gate decision until you
        approve it below.
      </p>
      <button className="replay-btn" onClick={generate} disabled={generating}>
        {generating ? "Generating…" : "Generate 5 scenarios ▸"}
      </button>
      {error && <p style={{ color: "var(--rose)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{error}</p>}

      {syntheticItems.length > 0 && (
        <ul className="ds-items" style={{ marginTop: "1rem" }}>
          {syntheticItems.map((it) => (
            <li key={it.id} className="ds-item">
              <span className="ds-item-label">{it.label ?? "(unlabelled)"}</span>
              <span className={`pill pill-${it.approval_status === "approved" ? "ok" : it.approval_status === "rejected" ? "error" : "muted"}`}>
                {STATUS_LABEL[it.approval_status ?? "pending"]}
              </span>
              {it.generated_rationale && <span className="mono appc-dim">{it.generated_rationale}</span>}
              {it.approval_status === "pending" && (
                <span style={{ display: "flex", gap: "0.4rem" }}>
                  <button
                    className="replay-btn"
                    style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }}
                    onClick={() => review(it.id, "approved")}
                    disabled={reviewingId === it.id}
                  >
                    Approve
                  </button>
                  <button
                    className="replay-btn"
                    style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }}
                    onClick={() => review(it.id, "rejected")}
                    disabled={reviewingId === it.id}
                  >
                    Reject
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
