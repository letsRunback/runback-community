"use client";

import { useState } from "react";
import { useReplayModels } from "@/lib/replay/useReplayModels";
import type { PromptMessage, PromptVariable } from "@/lib/prompts/render";
import type { PromptModel } from "@/lib/prompts/prompts";

interface VariantResult {
  model_id: string;
  ok: boolean;
  error: string | null;
  output: { text: string | null; total_tokens: number | null; latency_ms: number };
}

export default function PlaygroundPanel({
  template,
  variables,
  model,
  params,
}: {
  template: PromptMessage[];
  variables: PromptVariable[];
  model: PromptModel;
  params: Record<string, unknown>;
}) {
  const models = useReplayModels();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(variables.map((v) => [v.name, v.default ?? ""]))
  );
  const [compare, setCompare] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<VariantResult[] | null>(null);

  function toggleCompare(id: string) {
    setCompare((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/prompts/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template, variables, values, model, params, compare_model_ids: compare }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="pol-editor">
      {variables.length > 0 && (
        <div className="pol-field">
          <span>Variables</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {variables.map((v) => (
              <input
                key={v.name}
                value={values[v.name] ?? ""}
                onChange={(e) => setValues((s) => ({ ...s, [v.name]: e.target.value }))}
                placeholder={v.description ?? v.name}
              />
            ))}
          </div>
        </div>
      )}

      <div className="pol-field">
        <span>Compare against <em>(optional — runs the same rendered prompt against each)</em></span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {models.filter((m) => m !== model.model_id).map((m) => (
            <label key={m} className="mono" style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <input type="checkbox" checked={compare.includes(m)} onChange={() => toggleCompare(m)} />
              {m}
            </label>
          ))}
        </div>
      </div>

      <div className="pol-actions">
        <button className="btn-fill" onClick={run} disabled={running}>{running ? "Running…" : "Run ▸"}</button>
        {error && <span className="gs-error">{error}</span>}
      </div>

      {results && (
        <div className="replay-compare" style={{ gridTemplateColumns: `repeat(${results.length}, 1fr)` }}>
          {results.map((r, i) => (
            <div key={r.model_id + i} className="replay-card" data-accent={i > 0 || undefined}>
              <div className="replay-card-head">{r.model_id}</div>
              {r.ok ? (
                <>
                  <dl className="kv" style={{ gridTemplateColumns: "70px 1fr" }}>
                    <dt>tokens</dt>
                    <dd className="mono">{r.output.total_tokens ?? "—"}</dd>
                    <dt>latency</dt>
                    <dd className="mono">{r.output.latency_ms} ms</dd>
                  </dl>
                  <div className="replay-card-text">{r.output.text?.trim() || "(no content)"}</div>
                </>
              ) : (
                <div className="replay-card-text" style={{ color: "var(--rose)" }}>{r.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
