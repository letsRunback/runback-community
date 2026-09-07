"use client";

import { useState, useTransition } from "react";

interface Props {
  runId: string;
  reason: "policy_block" | "error";
  detail: string;
}

export default function EnrollButton({ runId, reason, detail }: Props) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  function enroll() {
    setErr("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/golden/enroll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ run_id: runId, reason, detail }),
        });
        const data = await res.json();
        if (data.ok) setDone(true);
        else setErr(data.error || "Failed.");
      } catch {
        setErr("Network error.");
      }
    });
  }

  if (done) {
    return (
      <span className="enroll-success">
        ✓ Enrolled in corpus
      </span>
    );
  }

  return (
    <span className="enroll-row">
      <button
        onClick={enroll}
        disabled={pending}
        className={`enroll-btn${pending ? " enroll-btn--pending" : ""}`}
      >
        {pending ? "Enrolling…" : "Enroll in corpus"}
      </button>
      {err && <span className="enroll-err">{err}</span>}
    </span>
  );
}
