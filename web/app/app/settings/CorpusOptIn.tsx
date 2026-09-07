"use client";
import { useState } from "react";

export default function CorpusOptIn({ current, canEdit, onSaved }: { current: boolean; canEdit: boolean; onSaved?: (next: boolean) => void }) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function toggle(next: boolean) {
    setValue(next);
    setBusy(true);
    setSaved(false);
    setError(false);
    try {
      const res = await fetch("/api/settings/corpus-optin", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ corpus_opt_in: next }),
      });
      if (!res.ok) { setValue(!next); setError(true); return; }
      setSaved(true);
      onSaved?.(next);
    } catch {
      setValue(!next);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="corpus-optin-row">
      <button
        className={`corpus-toggle${value ? " corpus-toggle-on" : ""}`}
        disabled={busy || !canEdit}
        onClick={() => toggle(!value)}
        aria-pressed={value}
      >
        <span className="corpus-toggle-thumb" />
      </button>
      <span className="corpus-optin-label">
        {value ? "Contributing anonymized signals" : "Not contributing"}
      </span>
      {busy && <span className="mono corpus-optin-status corpus-optin-status--saving">saving…</span>}
      {saved && !busy && <span className="mono corpus-optin-status corpus-optin-status--saved">saved</span>}
      {error && !busy && <span className="mono corpus-optin-status corpus-optin-status--error">failed to save</span>}
    </div>
  );
}
