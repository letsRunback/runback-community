"use client";

/**
 * A teaching empty state: explains what a feature is and why it matters, with one
 * click to populate it with realistic sample data. Used wherever a page would
 * otherwise be blank and incomprehensible to a first-time user.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SampleDataEmpty({
  badge, title, lead, points, cta = "Load sample data →", seed = true, foot,
}: {
  badge: string;
  title: string;
  lead: string;
  points: string[];
  cta?: string;
  seed?: boolean;       // show the "load sample data" button
  foot?: string;        // override the footer line (e.g. "Create your first rule below.")
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    const res = await fetch("/api/app/seed-demo", { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (data.ok) router.refresh();
    else alert(data.error || "Could not load sample data.");
  }
  return (
    <div className="sde">
      <div className="sde-badge mono">{badge}</div>
      <h2 className="sde-h">{title}</h2>
      <p className="sde-lead">{lead}</p>
      <ul className="sde-points">
        {points.map((p, i) => <li key={i}><span className="sde-tick">→</span>{p}</li>)}
      </ul>
      {seed && <button className="btn-fill" onClick={load} disabled={loading}>{loading ? "Loading sample…" : cta}</button>}
      <p className="sde-foot">{foot ?? "Seeds a few realistic agent runs — including a caught policy breach — so every page fills in and you can see it work."}</p>
    </div>
  );
}
