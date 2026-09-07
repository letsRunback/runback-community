"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IncidentSeverity } from "@/lib/incidents";

interface Props {
  runId: string;
  runName?: string;
  rootCause: string;
  severity: IncidentSeverity;
}

export default function IncidentButton({ runId, runName, rootCause, severity }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          run_id:     runId,
          run_name:   runName,
          title:      runName ? `${runName} — policy block` : `Policy block in run ${runId.slice(0, 8)}`,
          severity,
          root_cause: rootCause,
        }),
      });
      if (res.ok) {
        const { incident } = await res.json();
        router.push(`/app/incidents/${incident.id}`);
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Couldn't open the incident.");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button className="apprun-incident-btn" onClick={open} disabled={busy}>
        {busy ? "Opening…" : "Open as incident"}
      </button>
      {error && <span className="apv-btn-err">{error}</span>}
    </span>
  );
}
