"use client";

import { useState, useTransition } from "react";
import { VERTICALS, type Vertical } from "@/lib/verticals";

export default function VerticalPicker({ current, canEdit }: { current: Vertical; canEdit: boolean }) {
  const [selected, setSelected] = useState<Vertical>(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  async function save(v: Vertical) {
    const prev = selected;
    setSelected(v);
    setSaved(false);
    setError(false);
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/vertical", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vertical: v }),
        });
        if (!res.ok) { setSelected(prev); setError(true); return; }
        setSaved(true);
      } catch {
        setSelected(prev);
        setError(true);
      }
    });
  }

  return (
    <div className="vert-picker">
      <div className="vert-picker-grid">
        {(Object.entries(VERTICALS) as [Vertical, { label: string; emoji: string }][]).map(([key, { label, emoji }]) => (
          <button
            key={key}
            className={`vert-picker-opt${selected === key ? " vert-picker-opt-active" : ""}`}
            onClick={() => canEdit && save(key)}
            disabled={!canEdit || pending}
            aria-pressed={selected === key}
          >
            <span className="vert-picker-emoji">{emoji}</span>
            <span className="vert-picker-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="vert-picker-status mono">
        {pending ? "Saving…" : error ? "Failed to save — try again" : saved ? "✓ Saved — benchmarks will update nightly" : !canEdit ? "Read-only — contact an owner to change" : ""}
      </div>
    </div>
  );
}
