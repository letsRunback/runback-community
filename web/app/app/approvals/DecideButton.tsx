"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DecideButton({
  id,
  decision,
}: {
  id: string;
  decision: "approved" | "rejected";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function go() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="apv-btn-wrap">
      <button
        className={`apv-btn apv-btn-${decision}`}
        onClick={go}
        disabled={loading}
      >
        {loading ? "…" : decision === "approved" ? "Approve" : "Reject"}
      </button>
      {error && <span className="apv-btn-err">{error}</span>}
    </span>
  );
}
