"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline "new dataset" form for the datasets index page. Used on both the
 * public/marketing /datasets page and the authenticated /app/datasets page —
 * basePath picks which dataset detail route to land on after creating one, so
 * the app-shell instance doesn't redirect a signed-in user out to the public,
 * logged-out marketing chrome.
 */
export default function NewDatasetButton({ basePath = "/datasets" }: { basePath?: "/datasets" | "/app/datasets" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || `HTTP ${res.status}`);
        setSaving(false);
        return;
      }
      router.push(`${basePath}/${data.dataset.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="replay-btn" onClick={() => setOpen(true)}>
        + New dataset
      </button>
    );
  }

  return (
    <div className="ds-form">
      <input
        className="replay-edit"
        style={{ minHeight: 0 }}
        placeholder="Dataset name (e.g. Refund-flow regressions)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <input
        className="replay-edit"
        style={{ minHeight: 0 }}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="replay-btn" onClick={create} disabled={saving || !name.trim()}>
          {saving ? "Creating…" : "Create"}
        </button>
        <button className="replay-btn ghost" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </button>
      </div>
      {error && <span style={{ color: "var(--rose)", fontSize: "0.8rem" }}>{error}</span>}
    </div>
  );
}
