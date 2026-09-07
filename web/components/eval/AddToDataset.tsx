"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LlmEvent } from "@runback/schema";
import { parseJsonLoose, type ScorerConfig } from "@/lib/eval/scorers";

interface DatasetOption {
  id: string;
  name: string;
  item_count: number;
}

const NEW = "__new__";

/** First scalar leaf (string/number/boolean) in a tool's input, as a dot-path — the
 *  natural thing to pin (e.g. issue_refund.amount = 250). Depth-first, shallow. */
function firstScalarArg(input: unknown, prefix = "", depth = 0): { path: string; value: string | number | boolean } | null {
  if (input == null || typeof input !== "object" || depth > 3) return null;
  const entries = Array.isArray(input) ? input.map((v, i) => [String(i), v] as const) : Object.entries(input);
  for (const [k, v] of entries) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return { path, value: v };
  }
  for (const [k, v] of entries) {
    const nested = firstScalarArg(v, prefix ? `${prefix}.${k}` : k, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * Turns a captured LLM step into a regression fixture: pick (or create) a
 * dataset, label it, and choose the assertions its output must keep satisfying.
 * Defaults are derived from what the model actually did, so a useful test is one
 * click away.
 */
export default function AddToDataset({ event, basePath = "/datasets" }: { event: LlmEvent; basePath?: "/datasets" | "/app/datasets" }) {
  const firstTool = event.response.tool_calls[0]?.tool_name ?? null;
  const finish = event.response.finish_reason;
  // Surface the deep scorers ONLY when the capture makes them relevant (no clutter).
  const pinnableArg = firstTool ? firstScalarArg(event.response.tool_calls[0]?.input) : null;
  const outputIsJson = typeof event.response.text === "string" && parseJsonLoose(event.response.text).ok;

  const [open, setOpen] = useState(false);
  const [datasets, setDatasets] = useState<DatasetOption[] | null>(null);
  const [datasetId, setDatasetId] = useState<string>(NEW);
  const [newName, setNewName] = useState("");
  const [label, setLabel] = useState(
    `${event.model.model_id} · ${event.span_id.slice(0, 8)}`
  );

  // Scorer toggles, seeded from the captured behaviour.
  const [noError, setNoError] = useState(true);
  const [assertTool, setAssertTool] = useState(!!firstTool);
  const [pinArg, setPinArg] = useState(false);
  const [assertFinish, setAssertFinish] = useState(false);
  const [assertJson, setAssertJson] = useState(false);
  const [containsText, setContainsText] = useState("");
  const [rubric, setRubric] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ dataset_id: string } | null>(null);

  useEffect(() => {
    if (!open || datasets) return;
    fetch("/api/datasets")
      .then((r) => r.json())
      .then((d) => {
        const list = (d.datasets ?? []) as DatasetOption[];
        setDatasets(list);
        if (list.length > 0) setDatasetId(list[0].id);
      })
      .catch(() => setDatasets([]));
  }, [open, datasets]);

  function buildScorers(): ScorerConfig[] {
    const scorers: ScorerConfig[] = [];
    if (noError) scorers.push({ type: "no_error" });
    if (assertTool && firstTool) scorers.push({ type: "tool_called", tool: firstTool });
    if (pinArg && firstTool && pinnableArg)
      scorers.push({ type: "tool_arg", tool: firstTool, path: pinnableArg.path, op: "eq", value: pinnableArg.value });
    if (assertFinish && finish) scorers.push({ type: "finish_reason", equals: finish });
    if (assertJson && outputIsJson) scorers.push({ type: "json_valid" });
    if (containsText.trim())
      scorers.push({ type: "contains", value: containsText.trim(), caseInsensitive: true });
    if (rubric.trim()) scorers.push({ type: "llm_judge", rubric: rubric.trim() });
    return scorers;
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      let targetId = datasetId;
      if (datasetId === NEW) {
        if (!newName.trim()) {
          setError("Name the new dataset first.");
          setSaving(false);
          return;
        }
        const res = await fetch("/api/datasets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newName.trim(), source_run_id: event.run_id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.detail || data.error || `HTTP ${res.status}`);
          setSaving(false);
          return;
        }
        targetId = data.dataset.id;
      }

      const scorers = buildScorers();
      const res = await fetch(`/api/datasets/${targetId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_run_id: event.run_id,
          source_span_id: event.span_id,
          label: label.trim(),
          scorers,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || `HTTP ${res.status}`);
        setSaving(false);
        return;
      }
      setDone({ dataset_id: targetId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="add-ds-done">
        <span>Added to dataset ✓</span>
        <Link href={`${basePath}/${done.dataset_id}`} style={{ color: "var(--blue)" }}>
          View dataset →
        </Link>
      </div>
    );
  }

  if (!open) {
    return (
      <button className="add-ds-trigger" onClick={() => setOpen(true)}>
        + Add to dataset
      </button>
    );
  }

  const scorerCount = buildScorers().length;

  return (
    <div className="add-ds">
      <div className="add-ds-head">
        Save this step as a regression test
        <button className="add-ds-x" onClick={() => setOpen(false)} aria-label="Close">
          ✕
        </button>
      </div>

      <label className="add-ds-label">Dataset</label>
      <select
        className="replay-select"
        value={datasetId}
        onChange={(e) => setDatasetId(e.target.value)}
      >
        {(datasets ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.item_count})
          </option>
        ))}
        <option value={NEW}>➕ New dataset…</option>
      </select>
      {datasetId === NEW && (
        <input
          className="replay-edit"
          style={{ minHeight: 0, marginTop: "0.5rem" }}
          placeholder="New dataset name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
      )}

      <label className="add-ds-label">Label</label>
      <input
        className="replay-edit"
        style={{ minHeight: 0 }}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />

      <label className="add-ds-label">Assertions the output must keep passing</label>
      <label className="add-ds-check">
        <input type="checkbox" checked={noError} onChange={(e) => setNoError(e.target.checked)} />
        Must not error
      </label>
      {firstTool && (
        <label className="add-ds-check">
          <input
            type="checkbox"
            checked={assertTool}
            onChange={(e) => setAssertTool(e.target.checked)}
          />
          Must call <span className="mono">{firstTool}</span>
        </label>
      )}
      {firstTool && pinnableArg && (
        <label className="add-ds-check">
          <input type="checkbox" checked={pinArg} onChange={(e) => setPinArg(e.target.checked)} />
          Pin <span className="mono">{pinnableArg.path}</span> = <span className="mono">{JSON.stringify(pinnableArg.value)}</span>
        </label>
      )}
      {outputIsJson && (
        <label className="add-ds-check">
          <input type="checkbox" checked={assertJson} onChange={(e) => setAssertJson(e.target.checked)} />
          Output must stay valid JSON
        </label>
      )}
      {finish && (
        <label className="add-ds-check">
          <input
            type="checkbox"
            checked={assertFinish}
            onChange={(e) => setAssertFinish(e.target.checked)}
          />
          finish_reason = <span className="mono">{finish}</span>
        </label>
      )}
      <input
        className="replay-edit"
        style={{ minHeight: 0, marginTop: "0.4rem" }}
        placeholder="Response must contain… (optional)"
        value={containsText}
        onChange={(e) => setContainsText(e.target.value)}
      />
      <textarea
        className="replay-edit"
        style={{ marginTop: "0.4rem" }}
        rows={2}
        placeholder="LLM-judge rubric… (optional, e.g. 'Is polite and refuses the refund')"
        value={rubric}
        onChange={(e) => setRubric(e.target.value)}
      />

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem", alignItems: "center" }}>
        <button className="replay-btn" onClick={submit} disabled={saving || scorerCount === 0}>
          {saving ? "Saving…" : `Add with ${scorerCount} scorer${scorerCount === 1 ? "" : "s"}`}
        </button>
        {scorerCount === 0 && (
          <span style={{ color: "var(--amber)", fontSize: "0.75rem" }}>
            Pick at least one assertion.
          </span>
        )}
      </div>
      {error && (
        <div className="callout-error" style={{ marginTop: "0.6rem" }}>
          <div className="ce-msg">{error}</div>
        </div>
      )}
    </div>
  );
}
