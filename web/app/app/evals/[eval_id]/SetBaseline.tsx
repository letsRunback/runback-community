"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetBaseline({ evalId }: { evalId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function set() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/evals/${evalId}/baseline`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) { setDone(true); router.refresh(); return; }
      setError(data.error || "Couldn't set the baseline.");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span>
      <button className="btn-line" onClick={set} disabled={busy || done}>
        {done ? "✓ Baseline set" : busy ? "Setting…" : "Set as regression baseline"}
      </button>
      {error && <span className="apv-btn-err">{error}</span>}
    </span>
  );
}
