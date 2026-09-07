"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MoveLabelButton({
  name,
  label,
  versions,
  current,
}: {
  name: string;
  label: string;
  versions: number[];
  current: number | null;
}) {
  const router = useRouter();
  const [version, setVersion] = useState(String(current ?? versions[0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move() {
    // Production feeds live traffic (agents pick up a label change within
    // ~60s, per the runtime-fetch endpoint's cache window) — a misclick here
    // has real blast radius, unlike every other one-click button in this app.
    if (label === "production" && !window.confirm(`Move "production" to v${version}? Agents fetching this prompt pick up the change within about a minute.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(name)}/labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, version: Number(version) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <select className="replay-select" style={{ width: "auto" }} value={version} onChange={(e) => setVersion(e.target.value)} disabled={busy}>
        {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
      </select>
      <button className="btn-line" onClick={move} disabled={busy || Number(version) === current}>
        {busy ? "Moving…" : "Move"}
      </button>
      {error && <span className="gs-error">{error}</span>}
    </div>
  );
}
