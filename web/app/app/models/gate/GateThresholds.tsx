"use client";

import { useState, type CSSProperties } from "react";

export default function GateThresholds({ canAdmin, passThreshold, warnThreshold }: { canAdmin: boolean; passThreshold: number; warnThreshold: number }) {
  const [editing, setEditing] = useState(false);
  const [pass, setPass] = useState(String(Math.round(passThreshold * 100)));
  const [warn, setWarn] = useState(String(Math.round(warnThreshold * 100)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const p = Number(pass) / 100, w = Number(warn) / 100;
    if (!(p > w && w >= 0 && p <= 1)) { setError("Pass threshold must be higher than warn threshold."); return; }
    setSaving(true);
    const res = await fetch("/api/models/gate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_thresholds", passThreshold: p, warnThreshold: w }),
    });
    setSaving(false);
    if (res.ok) { setEditing(false); location.reload(); }
    else { const d = await res.json().catch(() => ({})); setError(d.error || "Could not save."); }
  }

  const inputStyle: CSSProperties = {
    width: "3.2rem", background: "transparent", border: "1px solid var(--border)",
    borderRadius: "4px", color: "inherit", font: "inherit", padding: "0 0.25rem", textAlign: "center",
  };

  if (!editing) {
    return (
      <p className="appc-sub mono" style={{ marginTop: "-0.5rem" }}>
        Pass ≥ {Math.round(passThreshold * 100)}% · Warn ≥ {Math.round(warnThreshold * 100)}%
        {canAdmin && <> · <button className="appc-link" onClick={() => setEditing(true)}>edit →</button></>}
      </p>
    );
  }

  return (
    <p className="appc-sub mono" style={{ marginTop: "-0.5rem", display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
      <span>Pass ≥ <input style={inputStyle} type="number" min={0} max={100} value={pass} onChange={(e) => setPass(e.target.value)} />%</span>
      <span>· Warn ≥ <input style={inputStyle} type="number" min={0} max={100} value={warn} onChange={(e) => setWarn(e.target.value)} />%</span>
      <span>· <button className="appc-link" onClick={save} disabled={saving}>{saving ? "saving…" : "save"}</button></span>
      <span>· <button className="appc-link" onClick={() => setEditing(false)}>cancel</button></span>
      {error && <span style={{ color: "var(--rose)" }}>{error}</span>}
    </p>
  );
}
