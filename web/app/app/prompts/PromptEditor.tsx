"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { REPLAY_MODELS } from "@/lib/replay/models";
import { extractVariableNames, type PromptMessage, type PromptVariable } from "@/lib/prompts/render";

const EXAMPLE = JSON.stringify(
  [
    { role: "system", content: "You are a support agent for {{company}}. Be concise and never invent policy." },
    { role: "user", content: "Customer: {{customer_message}}" },
  ],
  null,
  2
);

/** Infer a provider from a model id — mirrors lib/replay/runStep.ts's providerForModel, kept
 *  as a small standalone copy so this client component never bundles the provider SDKs. */
function providerFor(modelId: string): string {
  const m = modelId.toLowerCase();
  if (/^claude/.test(m)) return "anthropic";
  if (/^(gpt-(3|4)|o1|o3|o4|chatgpt|text-)/.test(m)) return "openai";
  return "groq";
}

interface VarMeta {
  required: boolean;
  default: string;
  description: string;
}

const DEFAULT_VAR_META: VarMeta = { required: true, default: "", description: "" };

export default function PromptEditor() {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(EXAMPLE);
  const [modelId, setModelId] = useState(REPLAY_MODELS[0]);
  const [commitMessage, setCommitMessage] = useState("");
  const [variableMeta, setVariableMeta] = useState<Record<string, VarMeta>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  // Every {{var}} in the template is a variable by default — detected live as
  // the template is edited. Invalid JSON just keeps the last valid list
  // instead of the row disappearing on every keystroke.
  const detectedNames = useMemo(() => {
    try {
      return extractVariableNames(JSON.parse(template) as PromptMessage[]);
    } catch {
      return null;
    }
  }, [template]);

  function updateVar(varName: string, patch: Partial<VarMeta>) {
    setVariableMeta((prev) => {
      const current = prev[varName] ?? DEFAULT_VAR_META;
      return { ...prev, [varName]: { ...current, ...patch } };
    });
  }

  async function save() {
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(template);
    } catch {
      setMsg({ ok: false, text: "Template must be valid JSON." });
      return;
    }
    const variables: PromptVariable[] = (detectedNames ?? []).map((varName) => {
      const meta = variableMeta[varName];
      return {
        name: varName,
        required: meta?.required ?? true,
        default: meta?.default?.trim() || undefined,
        description: meta?.description?.trim() || undefined,
      };
    });
    setSaving(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          template: parsed,
          model: { provider: providerFor(modelId), model_id: modelId },
          variables,
          commit_message: commitMessage || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setMsg({ ok: true, text: `Saved "${data.prompt.name}" v${data.prompt.version}.` });
        setName("");
        setCommitMessage("");
        router.refresh();
      } else {
        setMsg({ ok: false, text: data.error || "Failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pol-editor">
      <div className="pol-field">
        <span>Prompt name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="support-agent" />
      </div>
      <div className="pol-field">
        <span>Model</span>
        <select className="replay-select" style={{ width: "auto", minWidth: 220 }} value={modelId} onChange={(e) => setModelId(e.target.value)}>
          {REPLAY_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="pol-field">
        <span>
          Template <em>(JSON — [{"{role, content}"}], use {"{{var}}"} for variables)</em>{" "}
          <button type="button" className="pol-link" onClick={() => setTemplate(EXAMPLE)}>load example</button>
        </span>
        <textarea className="pol-rules mono" value={template} onChange={(e) => setTemplate(e.target.value)} rows={12} spellCheck={false} />
        <details className="pol-syntax">
          <summary>Variable syntax →</summary>
          <div className="pol-syntax-body">
            <p>Any <code className="mono">{"{{name}}"}</code> in a message&apos;s content becomes a variable — required by default, or optional with a default value below.</p>
          </div>
        </details>
      </div>
      {detectedNames && detectedNames.length > 0 && (
        <div className="pol-field">
          <span>Variables <em>(detected from the template)</em></span>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {detectedNames.map((varName) => {
              const meta = variableMeta[varName] ?? DEFAULT_VAR_META;
              return (
                <div key={varName} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <code className="mono" style={{ minWidth: 140 }}>{varName}</code>
                  <label className="mono" style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <input type="checkbox" checked={meta.required} onChange={(e) => updateVar(varName, { required: e.target.checked })} />
                    required
                  </label>
                  {!meta.required && (
                    <input
                      value={meta.default}
                      onChange={(e) => updateVar(varName, { default: e.target.value })}
                      placeholder="default value"
                      style={{ maxWidth: 180 }}
                    />
                  )}
                  <input
                    value={meta.description}
                    onChange={(e) => updateVar(varName, { description: e.target.value })}
                    placeholder="description (optional)"
                    style={{ flex: 1, minWidth: 160 }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="pol-field">
        <span>Commit message <em>(optional)</em></span>
        <input value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder="Tightened the escalation instruction" />
      </div>
      <div className="pol-actions">
        <button className="btn-fill" onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save version"}</button>
        {msg && <span className={msg.ok ? "team-ok" : "gs-error"}>{msg.text}</span>}
      </div>
    </div>
  );
}
