"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";

export interface Team {
  id: string;
  name: string;
  budget_usd: number | null;
  color: string | null;
}

export interface AgentRule {
  id: string;
  team_id: string;
  prefix: string;
}

// Deliberately its own categorical palette, not the --blue/--violet/--emerald/
// --amber/--rose tokens from globals.css: those are reserved as a semantic
// pair (LLM step vs. tool step) used throughout the trace UI, and repointing
// them for arbitrary user-picked team colors would break that meaning
// elsewhere. Team colors are a free-standing qualitative set instead.
const PRESET_COLORS = ["#4f9cf9", "#a78bfa", "#34d399", "#f59e0b", "#f43f5e", "#fb923c"];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="teams-color-picker">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`teams-color-swatch${value === c ? " teams-color-swatch--active" : ""}`}
          style={{ background: c }}
          aria-label={c}
        />
      ))}
    </div>
  );
}

function TeamManager({ initialTeams, initialRules }: { initialTeams: Team[]; initialRules: AgentRule[] }) {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [rules, setRules] = useState<AgentRule[]>(initialRules);
  const [isPending, startTransition] = useTransition();

  const [newName, setNewName] = useState("");
  const [newBudget, setNewBudget] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newPrefix, setNewPrefix] = useState("");
  const [newRuleTeamId, setNewRuleTeamId] = useState("");
  const [editingBudget, setEditingBudget] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/chargeback/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), budget_usd: newBudget ? parseFloat(newBudget) : null, color: newColor }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      const team: Team = await res.json();
      setTeams((prev) => [...prev, team]);
      setNewName("");
      setNewBudget("");
      setNewColor(PRESET_COLORS[0]);
      if (!newRuleTeamId) setNewRuleTeamId(team.id);
    });
  }

  async function removeTeam(teamId: string) {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/chargeback/teams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: teamId }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      setRules((prev) => prev.filter((r) => r.team_id !== teamId));
    });
  }

  async function saveBudget(teamId: string) {
    const raw = editingBudget[teamId];
    const budgetUsd = raw === "" ? null : parseFloat(raw);
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/chargeback/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: teamId, budget_usd: budgetUsd }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      setTeams((prev) => prev.map((t) => t.id === teamId ? { ...t, budget_usd: budgetUsd } : t));
      setEditingBudget((prev) => { const n = { ...prev }; delete n[teamId]; return n; });
    });
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newPrefix.trim() || !newRuleTeamId) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/chargeback/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: newRuleTeamId, prefix: newPrefix.trim() }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      const rulesRes = await fetch("/api/chargeback/teams?rules=1");
      if (rulesRes.ok) setRules(await rulesRes.json());
      setNewPrefix("");
    });
  }

  async function removeRule(ruleId: string) {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/chargeback/teams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    });
  }

  const teamById = new Map(teams.map((t) => [t.id, t]));

  return (
    <div>
      {error && <div className="teams-error">{error}</div>}

      <h2 className="teams-section-heading">Teams</h2>
      {teams.length === 0 && <div className="teams-empty">No teams yet. Add your first team below.</div>}

      <div className="teams-list">
        {teams.map((team) => (
          <div key={team.id} className="teams-row">
            <div className="teams-dot" style={{ background: team.color ?? "#4f9cf9" }} />
            <span className="teams-row-name">{team.name}</span>
            {editingBudget[team.id] !== undefined ? (
              <div className="teams-budget-edit">
                <span className="teams-budget-label mono">$/mo</span>
                <input
                  type="number"
                  value={editingBudget[team.id]}
                  onChange={(e) => setEditingBudget((prev) => ({ ...prev, [team.id]: e.target.value }))}
                  placeholder="unlimited"
                  className="teams-budget-input mono"
                />
                <button onClick={() => saveBudget(team.id)} disabled={isPending} className="teams-btn-save">Save</button>
                <button onClick={() => setEditingBudget((prev) => { const n = { ...prev }; delete n[team.id]; return n; })} className="teams-btn-cancel">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setEditingBudget((prev) => ({ ...prev, [team.id]: team.budget_usd != null ? String(team.budget_usd) : "" }))}
                className="teams-budget-toggle mono"
              >
                {team.budget_usd != null ? `$${team.budget_usd}/mo` : "Set budget"}
              </button>
            )}
            <button onClick={() => removeTeam(team.id)} disabled={isPending} className="teams-remove-btn" title="Delete team">✕</button>
          </div>
        ))}
      </div>

      <form onSubmit={addTeam} className="teams-add-form">
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Team name" required className="teams-input mono" />
        <input type="number" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="Budget $/mo (optional)" min={0} className="teams-input teams-input--budget mono" />
        <ColorPicker value={newColor} onChange={setNewColor} />
        <button type="submit" disabled={isPending || !newName.trim()} className="teams-btn-submit" style={{ opacity: isPending || !newName.trim() ? 0.5 : 1 }}>Add team</button>
      </form>

      <h2 className="teams-section-heading">Agent prefix rules</h2>
      <p className="teams-section-desc">Agents whose names start with a prefix are automatically attributed to the matched team.</p>

      {rules.length > 0 && (
        <div className="teams-rules-table-wrap">
          <table className="teams-rules-table mono">
            <thead><tr>{(["Prefix", "Team", ""] as string[]).map((h) => <th key={h} className="teams-th">{h}</th>)}</tr></thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="teams-tr">
                  <td className="teams-td teams-td--prefix">{rule.prefix}*</td>
                  <td className="teams-td teams-td--team">
                    <span className="teams-rule-team">
                      <span className="teams-dot teams-dot--sm" style={{ background: teamById.get(rule.team_id)?.color ?? "#4f9cf9" }} />
                      {teamById.get(rule.team_id)?.name ?? rule.team_id}
                    </span>
                  </td>
                  <td className="teams-td teams-td--action"><button onClick={() => removeRule(rule.id)} disabled={isPending} className="teams-remove-rule-btn">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {teams.length > 0 && (
        <form onSubmit={addRule} className="teams-add-form">
          <input type="text" value={newPrefix} onChange={(e) => setNewPrefix(e.target.value)} placeholder="Agent prefix (e.g. loan-)" required className="teams-input teams-input--prefix mono" />
          <select value={newRuleTeamId} onChange={(e) => setNewRuleTeamId(e.target.value)} required className="teams-select mono">
            <option value="">Select team…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="submit" disabled={isPending || !newPrefix.trim() || !newRuleTeamId} className="teams-btn-submit" style={{ opacity: isPending || !newPrefix.trim() || !newRuleTeamId ? 0.5 : 1 }}>Add rule</button>
        </form>
      )}
    </div>
  );
}

export default function CostTeamsClient({ demoTeams, demoRules }: { demoTeams?: Team[]; demoRules?: AgentRule[] } = {}) {
  const isDemo = !!demoTeams;
  const [teams, setTeams] = useState<Team[]>(demoTeams ?? []);
  const [rules, setRules] = useState<AgentRule[]>(demoRules ?? []);
  const [loading, setLoading] = useState(!isDemo);

  useEffect(() => {
    // Glimpse mode: illustrative fixtures passed in from the page — never hit
    // the live API (which would 403 a non-entitled org and show an empty state).
    if (isDemo) return;
    Promise.all([
      fetch("/api/chargeback/teams").then((r) => r.json()),
      fetch("/api/chargeback/teams?rules=1").then((r) => r.json()),
    ]).then(([t, r]) => {
      setTeams(t);
      setRules(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isDemo]);

  return (
    <div className="appc">
      <div className="appc-head appc-head-row">
        <div>
          <h1 className="appc-h1">Team setup</h1>
          <p className="appc-sub">Assign agents to teams and set monthly budgets for chargeback reporting.</p>
        </div>
        <Link href="/app/cost" className="teams-back-link">← Back to cost</Link>
      </div>
      {loading ? <div className="teams-loading">Loading…</div> : <TeamManager initialTeams={teams} initialRules={rules} />}
    </div>
  );
}
