"use client";

import { useState } from "react";
import type { LlmEvent, ModelMessage } from "@runback/schema";
import JsonView from "./JsonView";

/** "today" / "yesterday" / "5 days ago" / a date — for the "then" label. */
function whenLabel(ts: string | null | undefined): string {
  if (!ts) return "earlier";
  const d = new Date(ts).getTime();
  if (isNaN(d)) return "earlier";
  const days = Math.floor((Date.now() - d) / 86400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

interface ReplayResult {
  response: {
    text: string | null;
    reasoning: string | null;
    finish_reason: string | null;
    tool_calls: { tool_call_id: string; tool_name: string; input: unknown }[];
    usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  };
  latency_ms: number;
  edited: boolean;
  model: { provider: string; model_id: string };
  demo?: boolean;
  regression?: boolean;
}

/** Is a message's content a plain editable string? */
function editableText(m: ModelMessage): string | null {
  if (typeof m.content === "string") return m.content;
  return null;
}

const GOOD_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3-32b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];
// These intermittently malform tool calls with the AI SDK on Groq.
const FLAKY_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

export default function ReplayPanel({ event }: { event: LlmEvent }) {
  const capturedModel = event.model.model_id;
  // If the captured model is unreliable for tool calls, default to a solid one
  // so replay works out of the box — the user can switch back for exact fidelity.
  const hasTools = event.request.tools.length > 0;
  const defaultModel =
    hasTools && FLAKY_MODELS.includes(capturedModel) ? "openai/gpt-oss-120b" : capturedModel;
  const [modelId, setModelId] = useState(defaultModel);
  const modelOptions = Array.from(new Set([capturedModel, ...GOOD_MODELS]));

  const [system, setSystem] = useState(event.request.system ?? "");
  const [drafts, setDrafts] = useState<Record<number, string>>(() => {
    const d: Record<number, string> = {};
    event.request.messages.forEach((m, i) => {
      const t = editableText(m);
      if (t !== null) d[i] = t;
    });
    return d;
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promptEdited =
    system !== (event.request.system ?? "") ||
    event.request.messages.some(
      (m, i) => editableText(m) !== null && drafts[i] !== editableText(m)
    );
  const edited = promptEdited || modelId !== capturedModel;

  async function runReplay() {
    setLoading(true);
    setError(null);
    setResult(null);
    // Rebuild messages with edited text applied.
    const messages: ModelMessage[] = event.request.messages.map((m, i) =>
      editableText(m) !== null ? { ...m, content: drafts[i] } : m
    );
    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          run_id: event.run_id,
          span_id: event.span_id,
          model_id: modelId,
          edits: promptEdited ? { system: system || null, messages } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setSystem(event.request.system ?? "");
    const d: Record<number, string> = {};
    event.request.messages.forEach((m, i) => {
      const t = editableText(m);
      if (t !== null) d[i] = t;
    });
    setDrafts(d);
    setModelId(defaultModel);
    setResult(null);
    setError(null);
  }

  const switchedForReliability =
    defaultModel !== capturedModel && modelId !== capturedModel;

  return (
    <div>
      <div className="insp-h">Replay this step</div>
      <div className="replay-why">
        <strong>Switching models or changing a prompt? See what breaks on your real cases.</strong>
        <p>
          Re-runs the <em>exact</em> request the model got {whenLabel(event.ts_start) === "today" ? "in this run" : whenLabel(event.ts_start)} —
          same context, same tools — against any model, or with an edited prompt. You get
          the new answer side by side, on real data, before it ships.{" "}
          <a href="/how-it-works#replay" target="_blank" rel="noopener">What&apos;s replay?</a>
        </p>
      </div>

      {/* editable system */}
      {(event.request.system !== null || system) && (
        <>
          <div className="insp-h">System prompt {system !== (event.request.system ?? "") && <Badge />}</div>
          <textarea
            className="replay-edit"
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            rows={Math.min(8, Math.max(2, system.split("\n").length))}
          />
        </>
      )}

      {/* editable messages */}
      {event.request.messages.map((m, i) => {
        const t = editableText(m);
        if (t === null) {
          return (
            <div key={i} style={{ marginTop: "0.6rem" }}>
              <div className="insp-h" style={{ marginTop: 0 }}>
                {m.role} (structured — read-only)
              </div>
              <JsonView value={m.content} initialDepth={1} />
            </div>
          );
        }
        return (
          <div key={i}>
            <div className="insp-h">
              {m.role} message {drafts[i] !== t && <Badge />}
            </div>
            <textarea
              className="replay-edit"
              value={drafts[i] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
              rows={Math.min(8, Math.max(2, (drafts[i] ?? "").split("\n").length))}
            />
          </div>
        );
      })}

      <div className="insp-h">
        Replay against {modelId !== capturedModel && <Badge label="changed" />}
      </div>
      <p className="replay-hint">Captured on <span className="mono">{capturedModel}</span>. Pick another model to compare its answer on this exact case.</p>
      <select
        className="replay-select"
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
      >
        {modelOptions.map((m) => (
          <option key={m} value={m}>
            {m}
            {m === capturedModel ? "  (captured)" : ""}
          </option>
        ))}
      </select>
      {switchedForReliability && (
        <p style={{ color: "var(--amber)", fontSize: "0.74rem", marginTop: "0.4rem" }}>
          Captured model <span className="mono">{capturedModel}</span> intermittently
          malforms tool calls on Groq, so replay defaults to a reliable model. Switch
          back above for exact fidelity.
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}>
        <button className="replay-btn" onClick={runReplay} disabled={loading}>
          {loading ? "Replaying…" : edited ? "Run edited replay" : "Replay as-is"}
        </button>
        {(edited || result) && (
          <button className="replay-btn ghost" onClick={reset} disabled={loading}>
            Reset
          </button>
        )}
      </div>

      {error && (
        <div className="callout-error">
          <div className="ce-title">Replay failed</div>
          <div className="ce-msg">{error}</div>
        </div>
      )}

      {result && (
        <>
          {result.demo && (
            <div className="callout-error" style={{ background: "var(--amber-dim)", borderColor: "rgba(224,138,42,0.3)" }}>
              <div className="ce-msg" style={{ color: "var(--text-primary)" }}>
                {result.edited ? (
                  <>
                    Simulated comparison — no live model was called. Self-host Runback
                    or add a model key to replay against the real provider.
                  </>
                ) : (
                  <>
                    Replayed on the captured model — reproduces exactly. Pick another
                    model above to see the answer diverge (simulated on the hosted demo).
                  </>
                )}
              </div>
            </div>
          )}
          {result.regression && (
            <div className="callout-error">
              <div className="ce-title">Behaviour changed</div>
              <div className="ce-msg">
                This model finished differently than the captured run — exactly the
                kind of regression replay surfaces before it ships.
              </div>
            </div>
          )}
          <div className="insp-h">
            Then vs now {result.edited && <Badge label="edited" />}
          </div>
          <div className="replay-compare">
            <ResponseCard
              title={`Then · ${whenLabel(event.ts_start)}`}
              subtitle={capturedModel}
              finish={event.response.finish_reason}
              text={event.response.text}
              reasoning={event.response.reasoning}
              toolCalls={event.response.tool_calls}
              tokens={event.usage?.total_tokens ?? null}
              latency={event.latency_ms}
            />
            <ResponseCard
              title="Now"
              subtitle={result.model.model_id}
              accent
              finish={result.response.finish_reason}
              text={result.response.text}
              reasoning={result.response.reasoning}
              toolCalls={result.response.tool_calls}
              tokens={result.response.usage?.total_tokens ?? null}
              latency={result.latency_ms}
              diffFinish={result.response.finish_reason !== event.response.finish_reason}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ label = "edited" }: { label?: string }) {
  return (
    <span className="pill pill-running" style={{ marginLeft: "0.4rem" }}>
      {label}
    </span>
  );
}

function ResponseCard({
  title,
  subtitle,
  finish,
  text,
  reasoning,
  toolCalls,
  tokens,
  latency,
  accent,
  diffFinish,
}: {
  title: string;
  subtitle?: string;
  finish: string | null;
  text: string | null;
  reasoning: string | null;
  toolCalls: { tool_call_id: string; tool_name: string; input: unknown }[];
  tokens: number | null;
  latency: number | null;
  accent?: boolean;
  diffFinish?: boolean;
}) {
  return (
    <div className="replay-card" data-accent={accent}>
      <div className="replay-card-head">
        {title}
        {subtitle && (
          <span style={{ color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}>
            {" · "}
            {subtitle}
          </span>
        )}
      </div>
      <dl className="kv" style={{ gridTemplateColumns: "70px 1fr" }}>
        <dt>finish</dt>
        <dd className="mono" style={diffFinish ? { color: "var(--amber)" } : undefined}>
          {finish ?? "—"}
        </dd>
        <dt>tokens</dt>
        <dd className="mono">{tokens ?? "—"}</dd>
        <dt>latency</dt>
        <dd className="mono">{latency != null ? `${latency} ms` : "—"}</dd>
      </dl>
      {reasoning && (
        <div className="replay-card-text" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
          {reasoning}
        </div>
      )}
      {text && <div className="replay-card-text">{text}</div>}
      {toolCalls.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          {toolCalls.map((tc) => (
            <div key={tc.tool_call_id} style={{ marginBottom: "0.4rem" }}>
              <span className="mono" style={{ color: "var(--violet)", fontSize: "0.75rem" }}>
                → {tc.tool_name}
              </span>
              <JsonView value={tc.input} initialDepth={1} />
            </div>
          ))}
        </div>
      )}
      {!text && !reasoning && toolCalls.length === 0 && (
        <div className="replay-card-text empty">(no content)</div>
      )}
    </div>
  );
}
