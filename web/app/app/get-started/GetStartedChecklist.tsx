"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SetupStep } from "@/lib/onboardingProgress";

export default function GetStartedChecklist({ steps }: { steps: SetupStep[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(steps.find((s) => !s.done)?.id ?? null);
  const [saving, setSaving] = useState<string | null>(null);

  async function markDone(id: string) {
    setSaving(id);
    const res = await fetch("/api/app/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stepId: id }),
    });
    const data = await res.json();
    setSaving(null);
    if (data.ok) router.refresh();
    else alert(data.error || "Could not save.");
  }

  return (
    <div className="gs-checklist">
      {steps.map((s) => {
        const open = openId === s.id;
        return (
          <div key={s.id} className={`gs-check-row${s.done ? " gs-check-row-done" : ""}${open ? " gs-check-row-open" : ""}`}>
            <button
              type="button"
              className="gs-check-row-btn"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : s.id)}
            >
              <span className="gs-check-mark" aria-hidden>{s.done ? "✓" : ""}</span>
              <span className="gs-check-label">{s.label}</span>
              {s.done && s.manuallyDone && <span className="gs-check-manual-tag mono">self-reported</span>}
              <span className="gs-check-cta mono">{open ? "Hide ↑" : "Do it →"}</span>
            </button>
            {open && (
              <div className="gs-check-detail">
                <ol className="gs-check-steps">
                  {s.detail.map((line, i) => <li key={i}>{line}</li>)}
                </ol>
                <div className="gs-check-actions">
                  {s.href && (
                    <Link href={s.href} className="btn-line btn-sm">Go there →</Link>
                  )}
                  {!s.done && (
                    <>
                      <button
                        type="button"
                        className="btn-fill btn-sm"
                        onClick={() => markDone(s.id)}
                        disabled={saving === s.id}
                      >
                        {saving === s.id ? "Saving…" : "Mark as done"}
                      </button>
                      <span className="gs-check-manual-hint mono">
                        This checks itself off the moment we detect it — only use this if you did it a way we can&apos;t see.
                      </span>
                    </>
                  )}
                  {s.done && s.manuallyDone && (
                    <span className="gs-check-manual mono">marked done manually</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
