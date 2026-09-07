"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Declare agents in bulk.
 *
 * Deliberately a paste box rather than a form: an inventory built one
 * submission at a time never gets built, and the list already exists in a CMDB
 * export, a risk register or a spreadsheet. Accepts `name, owner, criticality`
 * per line so a copied column works without reformatting.
 */
export default function CoverageControls({ canAdmin }: { canAdmin: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canAdmin) {
    return (
      <section className="dash-panel comp-panel-mt">
        <div className="dash-panel-h">Declare agents</div>
        <p className="empty comp-empty-sm">Ask an owner or admin to maintain the agent inventory.</p>
      </section>
    );
  }

  async function submit() {
    const agents = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, owner, criticality] = line.split(",").map((p) => p.trim());
        return {
          name,
          owner: owner || null,
          criticality: (["critical", "high", "standard", "low"].includes(criticality)
            ? criticality
            : "standard") as "critical" | "high" | "standard" | "low",
        };
      })
      .filter((a) => a.name);

    if (!agents.length) { setError("Nothing to declare — one agent name per line."); return; }

    setBusy(true); setError(null); setMsg(null);
    const d = await fetch("/api/app/coverage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agents }),
    }).then((r) => r.json());
    setBusy(false);

    if (d.ok) {
      setMsg(`${d.declared} agent${d.declared === 1 ? "" : "s"} declared.`);
      setText("");
      router.refresh();
    } else setError(d.error);
  }

  return (
    <section className="dash-panel comp-panel-mt">
      <div className="dash-panel-h">Declare agents</div>
      <p className="empty comp-empty-sm">
        One per line: <span className="mono">name, owner, criticality</span> — owner and criticality optional.
        The name must match what your SDK sends as <span className="mono">runName</span>, since that is the only
        key the two sides share. Re-declaring updates rather than duplicating.
      </p>
      <textarea
        className="settings-input coverage-paste"
        rows={5}
        placeholder={"support-agent, Support Ops, high\nkyc-agent, Compliance, critical\nfraud-agent, Risk, critical"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="settings-key-row">
        <button className="btn-fill" onClick={submit} disabled={busy}>
          {busy ? "Declaring…" : "Declare"}
        </button>
      </div>
      {msg && <p className="empty comp-empty-xs">{msg}</p>}
      {error && <p className="empty comp-empty-xs" role="alert">{error}</p>}
    </section>
  );
}
