"use client";

import { useEffect, useState } from "react";

interface Hold {
  id: string;
  reason: string;
  agent_name: string | null;
  covers_from: string | null;
  placed_by: string;
  placed_at: string;
  released_by: string | null;
  released_at: string | null;
}

/**
 * Place and release legal holds. A hold stops retention from deleting the runs
 * it covers, for as long as it is active.
 *
 * Releasing asks for confirmation because it re-arms deletion of records that
 * were deliberately preserved — the one action here that loses data.
 */
export default function LegalHolds({ canAdmin }: { canAdmin: boolean }) {
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [reason, setReason] = useState("");
  const [agentName, setAgentName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/app/legal-holds");
    const data = await res.json();
    if (data.ok) setHolds(data.holds);
    else setError(data.error);
  }
  // Awaited rather than called bare, so every setState sits behind an await
  // boundary instead of running synchronously inside the effect — same idiom
  // as ModelKeys.
  useEffect(() => { void (async () => { await load(); })(); }, []);

  async function place() {
    if (!reason.trim()) { setError("A hold needs a reason — the matter reference it derives from."); return; }
    setBusy(true); setError(null);
    const res = await fetch("/api/app/legal-holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, agentName: agentName.trim() || null }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok) { setReason(""); setAgentName(""); load(); }
    else setError(data.error);
  }

  async function release(h: Hold) {
    if (!confirm(`Release the hold on "${h.reason}"? Runs it preserved become eligible for deletion again.`)) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/app/legal-holds?id=${encodeURIComponent(h.id)}`, { method: "DELETE" });
    const data = await res.json();
    setBusy(false);
    if (data.ok) load(); else setError(data.error);
  }

  if (!canAdmin) {
    return (
      <div className="appc-card settings-card-full">
        <p className="settings-hint">Ask an owner or admin to manage legal holds.</p>
      </div>
    );
  }

  const active = (holds ?? []).filter((h) => !h.released_at);

  return (
    <div className="appc-card settings-card-full">
      <p className="settings-hint">
        A legal hold stops retention from deleting the runs it covers — for litigation, a regulator request, or an
        internal investigation. Leave the agent blank to hold everything in the workspace.
      </p>

      <div className="settings-key-row">
        <input
          className="settings-input" placeholder="Reason — matter reference or instruction"
          value={reason} onChange={(e) => setReason(e.target.value)}
        />
        <input
          className="settings-input" placeholder="Agent (optional)"
          value={agentName} onChange={(e) => setAgentName(e.target.value)}
        />
        <button className="btn-fill" onClick={place} disabled={busy}>Place hold</button>
      </div>

      {error && <p className="settings-hint" role="alert">{error}</p>}

      {holds === null ? (
        <p className="settings-hint">Loading…</p>
      ) : holds.length === 0 ? (
        <p className="settings-hint">No holds have been placed. Retention runs on its normal schedule.</p>
      ) : (
        <div className="table-wrap">
          <table className="appc-table">
            <thead>
              <tr><th>Reason</th><th>Scope</th><th>Placed</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {holds.map((h) => (
                <tr key={h.id}>
                  <td>{h.reason}</td>
                  <td className="mono appc-dim">{h.agent_name ?? "entire workspace"}</td>
                  <td className="mono appc-dim">
                    {new Date(h.placed_at).toLocaleDateString()} · {h.placed_by}
                  </td>
                  <td data-tone={h.released_at ? undefined : "emerald"}>
                    {h.released_at
                      ? `released ${new Date(h.released_at).toLocaleDateString()}`
                      : "active"}
                  </td>
                  <td>
                    {!h.released_at && (
                      <button className="btn-line" onClick={() => release(h)} disabled={busy}>Release</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active.length > 0 && (
        <p className="settings-hint">
          {active.length} active hold{active.length === 1 ? "" : "s"} — retention is suspended for the runs they cover.
        </p>
      )}
    </div>
  );
}
