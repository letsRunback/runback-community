"use client";

import { useEffect, useState } from "react";

interface GrantRow {
  id: string;
  label: string;
  scope_type: "run_ids" | "control_ids" | "org_wide";
  run_ids: string[] | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

function scopeText(g: GrantRow): string {
  if (g.scope_type === "org_wide") return "all runs";
  if (g.scope_type === "run_ids") return `${g.run_ids?.length ?? 0} run${g.run_ids?.length === 1 ? "" : "s"}`;
  return "controls";
}

export default function ExternalGrantsSection({ canAdmin }: { canAdmin: boolean }) {
  const [grants, setGrants] = useState<GrantRow[] | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState("");
  const [scopeType, setScopeType] = useState<"org_wide" | "run_ids">("run_ids");
  const [runIds, setRunIds] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [error, setError] = useState("");

  function refresh() {
    fetch("/api/app/external-grants")
      .then((res) => res.json())
      .then((data) => { if (data.ok) setGrants(data.grants); });
  }
  useEffect(refresh, []);

  async function issue() {
    setError("");
    if (!label.trim()) { setError("Label is required."); return; }
    if (scopeType === "run_ids" && !runIds.trim()) { setError("At least one run id is required."); return; }
    setBusy(true);
    const res = await fetch("/api/app/external-grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: label.trim(),
        scope_type: scopeType,
        run_ids: scopeType === "run_ids" ? runIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        expires_in_days: expiresInDays,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) { setError(data.error || "Could not create a grant."); return; }
    setApiKey(data.apiKey);
    setLabel(""); setRunIds("");
    refresh();
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this grant? The key stops working immediately.")) return;
    await fetch(`/api/app/external-grants/${id}`, { method: "DELETE" });
    refresh();
  }

  function copy() {
    if (!apiKey) return;
    navigator.clipboard?.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!canAdmin) {
    return (
      <div className="appc-card settings-card-full">
        <p className="settings-hint">Ask an owner or admin to issue an external grant.</p>
      </div>
    );
  }

  return (
    <div className="appc-card settings-card-full">
      <p className="settings-hint">
        Read-only, scoped to specific runs (or all of them) and always time-limited — hand this to an auditor
        or regulator instead of a login. It downloads the exact same signed audit record a real account would see.
      </p>

      {apiKey ? (
        <div className="onb-key-row">
          <code className="onb-key mono">{apiKey}</code>
          <button className="btn-line" onClick={copy} style={{ fontSize: "0.82rem", padding: "0.3rem 0.75rem" }}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <span className="onb-key-hint">Save it — shown once.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              className="settings-input"
              placeholder="Label — e.g. SEC examiner, Q3 review"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={{ flex: "1 1 220px" }}
            />
            <select
              className="settings-input"
              value={scopeType}
              onChange={(e) => setScopeType(e.target.value as "org_wide" | "run_ids")}
              style={{ flex: "0 0 auto", width: "auto" }}
            >
              <option value="run_ids">Specific runs</option>
              <option value="org_wide">All runs</option>
            </select>
            <input
              className="settings-input"
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              style={{ width: "5rem" }}
              title="Expires in (days)"
            />
          </div>
          {scopeType === "run_ids" && (
            <input
              className="settings-input"
              placeholder="Run ids, comma-separated"
              value={runIds}
              onChange={(e) => setRunIds(e.target.value)}
            />
          )}
          {error && <p className="narrative-error">{error}</p>}
          <button className="btn-line" onClick={issue} disabled={busy} style={{ alignSelf: "flex-start" }}>
            {busy ? "Issuing…" : "Issue grant →"}
          </button>
        </div>
      )}

      {grants && grants.length > 0 && (
        <div className="settings-hint" style={{ marginTop: "0.75rem" }}>
          {grants.map((g) => {
            const revoked = !!g.revoked_at;
            const expired = !revoked && new Date(g.expires_at) < new Date();
            return (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0" }}>
                <span className={`pill ${revoked || expired ? "pill-muted" : "pill-success"} mono`}>
                  {revoked ? "revoked" : expired ? "expired" : "active"}
                </span>
                <span>{g.label}</span>
                <span className="mono" style={{ opacity: 0.6 }}>· {scopeText(g)} · expires {new Date(g.expires_at).toLocaleDateString()}</span>
                {!revoked && (
                  <button className="btn-line" onClick={() => revoke(g.id)} style={{ marginLeft: "auto", fontSize: "0.78rem", padding: "0.2rem 0.6rem" }}>
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
