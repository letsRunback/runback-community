"use client";

import { useState } from "react";

export default function ComplianceKeySection({ canAdmin }: { canAdmin: boolean }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    const res = await fetch("/api/app/compliance-key", { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (data.ok) setApiKey(data.apiKey);
    else alert(data.error || "Could not generate key.");
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
        <p className="settings-hint">Ask an owner or admin to generate a compliance-read key.</p>
      </div>
    );
  }

  return (
    <div className="appc-card settings-card-full">
      <p className="settings-hint">
        Read-only, scoped to <code className="mono">/api/v1/compliance/evidence-summary</code> only —
        no ingest, no run content, no dashboard access. Hand this to an integration
        (e.g. EAAPL) instead of your ingest key. Keys are shown once; generate a new one any time.
      </p>
      {!apiKey ? (
        <button className="btn-line" onClick={generate} disabled={loading} style={{ alignSelf: "flex-start" }}>
          {loading ? "Generating…" : "Generate compliance key →"}
        </button>
      ) : (
        <div className="onb-key-row">
          <code className="onb-key mono">{apiKey}</code>
          <button className="btn-line" onClick={copy} style={{ fontSize: "0.82rem", padding: "0.3rem 0.75rem" }}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <span className="onb-key-hint">Save it — shown once. Generate another to rotate.</span>
        </div>
      )}
    </div>
  );
}
