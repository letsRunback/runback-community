"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * DELETE /api/app/coverage had no caller anywhere in the app — an agent could
 * be declared but never retired once decommissioned, permanently showing up
 * as "undeclared"/gap in the estate table.
 */
export default function RetireAgentButton({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function retire() {
    if (!confirm(`Retire "${name}" from the declared inventory? This does not delete its runs.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/app/coverage?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setError(data.error || "Couldn't retire this agent."); return; }
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="team-remove" onClick={retire} disabled={busy} title="Retire">
        {busy ? "…" : "×"}
      </button>
      {error && <span className="apv-btn-err">{error}</span>}
    </span>
  );
}
