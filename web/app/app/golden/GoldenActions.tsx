"use client";

import { useTransition, useState } from "react";

interface Props {
  id: string;
  status: string;
  /** True when an approved entry hasn't had a fresh human look in a while —
   *  see needsReReview() in lib/goldenCore.ts. Reproducing the cassette isn't
   *  the same as the recorded behavior still being the correct one. */
  needsReReview?: boolean;
}

/**
 * Renders BOTH the STATUS cell and the ACTIONS cell for one row from a single
 * piece of state — they used to be two independent cells (a server-rendered
 * status badge + this component's own local state for the buttons), so an
 * approve/dismiss updated the buttons instantly but left the status badge
 * showing the stale server value ("Active") until a full page reload.
 */
export default function GoldenActions({ id, status, needsReReview }: Props) {
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(status);
  const [err, setErr] = useState("");

  async function act(action: "approve" | "dismiss") {
    setErr("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/golden/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) setCurrent(action === "approve" ? "approved" : "dismissed");
        else setErr(data.error || "Failed.");
      } catch {
        setErr("Network error.");
      }
    });
  }

  const statusCell = <span className={`mono golden-status golden-status--${current}`}>{current}</span>;

  if (current === "approved") {
    return (
      <>
        <td>{statusCell}</td>
        <td>
          <span className="golden-status-approved">✓ Approved</span>
          {needsReReview && (
            <span
              className="golden-status-stale"
              title="Approved a long time ago. Reproducing the cassette proves the incident still replays the same way — it doesn't confirm the recorded behavior is still the correct one."
            >
              {" "}· re-review due
            </span>
          )}
        </td>
      </>
    );
  }
  if (current === "dismissed") {
    return (
      <>
        <td>{statusCell}</td>
        <td><span className="golden-status-dismissed">Dismissed</span></td>
      </>
    );
  }

  return (
    <>
      <td>{statusCell}</td>
      <td>
        <span className="golden-actions-row">
          <button
            onClick={() => act("approve")}
            disabled={pending}
            className={`golden-btn golden-btn-approve${pending ? " golden-btn-pending" : ""}`}
          >
            Approve
          </button>
          <button
            onClick={() => act("dismiss")}
            disabled={pending}
            className={`golden-btn golden-btn-dismiss${pending ? " golden-btn-pending" : ""}`}
          >
            Dismiss
          </button>
          {err && <span className="golden-err">{err}</span>}
        </span>
      </td>
    </>
  );
}
