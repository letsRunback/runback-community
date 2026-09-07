"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GateForm({ allModels }: { allModels: string[] }) {
  const router = useRouter();
  const [fromModel, setFromModel] = useState("");
  const [toModel, setToModel] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromModel || !toModel || running) return;
    setError(null);
    setRunning(true);
    const res = await fetch("/api/models/gate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromModel, toModel }),
    }).catch(() => null);
    setRunning(false);
    if (!res || !res.ok) {
      const d = await res?.json().catch(() => ({}));
      setError(d?.error || "Could not run the gate.");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="gate-form">
      <div className="gate-form-field">
        <label className="gate-form-label">From model (current)</label>
        <select value={fromModel} onChange={(e) => setFromModel(e.target.value)} className="gate-form-select">
          <option value="">Select model</option>
          {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="gate-form-arrow">→</div>
      <div className="gate-form-field">
        <label className="gate-form-label">To model (candidate)</label>
        <select value={toModel} onChange={(e) => setToModel(e.target.value)} className="gate-form-select">
          <option value="">Select model</option>
          {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <button type="submit" className="btn-fill gate-form-submit" disabled={!fromModel || !toModel || running}>
        {running ? "Running…" : "Run gate →"}
      </button>
      {error && <p className="appc-sub" style={{ color: "var(--rose)", width: "100%" }}>{error}</p>}
    </form>
  );
}
