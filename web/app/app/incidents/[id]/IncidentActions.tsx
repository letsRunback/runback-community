"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IncidentStatus } from "@/lib/incidents";

interface Props {
  incidentId: string;
  runId: string;
  currentStatus: IncidentStatus;
  currentRootCause: string;
  currentRemediation: string;
  hasGoldenRun: boolean;
}

export default function IncidentActions({ incidentId, runId, currentStatus, currentRootCause, currentRemediation, hasGoldenRun }: Props) {
  const router = useRouter();
  const [rootCause, setRootCause] = useState(currentRootCause);
  // Was always "" — never seeded from the incident's actual saved remediation.
  // Combined with the textarea disappearing once status left "investigating"
  // (below), clicking "Close incident" from "remediated" silently overwrote
  // real remediation text with an empty string, invisibly, since the field
  // wasn't even on screen to show it was about to happen.
  const [remediation, setRemediation] = useState(currentRemediation);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState(hasGoldenRun);

  async function patch(patch: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, root_cause: rootCause, note: note || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to save.");
        return;
      }
      // Only clear the note once it has actually landed. It used to clear
      // unconditionally in `finally` below, so a failed save (a validation
      // error, a dropped connection) silently discarded whatever the user had
      // typed — the retry button was there, but the text to retry with was
      // already gone.
      setNote("");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    setEnrolling(true);
    setError("");
    try {
      const res = await fetch("/api/golden/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run_id: runId, reason: "policy_block", detail: rootCause }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Couldn't enroll this run.");
        return;
      }
      await fetch(`/api/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ golden_run_id: runId, note: "Enrolled as regression test" }),
      });
      setEnrolled(true);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setEnrolling(false);
    }
  }

  return (
    <div className="incd-actions">
      <div className="incd-field">
        <label className="incd-label mono">Root cause</label>
        <textarea
          className="incd-textarea"
          value={rootCause}
          onChange={e => setRootCause(e.target.value)}
          rows={3}
          placeholder="Describe what caused this incident…"
        />
      </div>

      {currentStatus !== "closed" && (
        <div className="incd-field">
          <label className="incd-label mono">Remediation notes</label>
          <textarea
            className="incd-textarea"
            value={remediation}
            onChange={e => setRemediation(e.target.value)}
            rows={2}
            placeholder="What was done to fix this?"
          />
        </div>
      )}

      <div className="incd-field">
        <label className="incd-label mono">Note (optional)</label>
        <input
          className="incd-input"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note to the timeline…"
        />
      </div>

      <div className="incd-btn-row">
        {currentStatus === "open" && (
          <button
            className="incd-btn incd-btn-primary"
            disabled={busy}
            onClick={() => patch({ status: "investigating", remediation })}
          >
            {busy ? "Saving…" : "Start investigating"}
          </button>
        )}

        {currentStatus === "investigating" && (
          <button
            className="incd-btn incd-btn-primary"
            disabled={busy}
            onClick={() => patch({ status: "remediated", remediation })}
          >
            {busy ? "Saving…" : "Mark remediated"}
          </button>
        )}

        {(currentStatus === "investigating" || currentStatus === "remediated") && (
          <button
            className="incd-btn incd-btn-close"
            disabled={busy}
            onClick={() => patch({ status: "closed", remediation })}
          >
            {busy ? "Saving…" : "Close incident"}
          </button>
        )}

        {currentStatus === "open" && (
          <button
            className="incd-btn incd-btn-ghost"
            disabled={busy}
            onClick={() => patch({ remediation })}
          >
            {busy ? "Saving…" : "Save notes"}
          </button>
        )}

        <button
          className="incd-btn incd-btn-enroll"
          disabled={enrolling || enrolled}
          onClick={enroll}
        >
          {enrolled ? "✓ Regression test enrolled" : enrolling ? "Enrolling…" : "Enroll as regression test"}
        </button>
        {error && <span className="incd-btn-err">{error}</span>}
      </div>
    </div>
  );
}
