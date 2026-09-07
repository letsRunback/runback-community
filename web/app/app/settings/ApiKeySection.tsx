"use client";

import { useState } from "react";

type Scope = "trace_write" | "ingest";

/**
 * Two kinds of key, chosen explicitly.
 *
 * Every key used to be issued with the historical "ingest" scope, which
 * resolves to role admin on the general API. That key is the most widely
 * distributed credential we hand out — it lives in customer applications, CI
 * runners and container images — so a leak carried far more than telemetry.
 *
 * The narrow scope existed in the API before it existed here, which meant
 * nobody could find it. Presenting both at the point of choice is the whole
 * fix: the decision is made once, when someone is already thinking about what
 * the key is for.
 */
const SCOPES: { key: Scope; label: string; blurb: string; recommended?: boolean }[] = [
  {
    key: "trace_write",
    label: "Telemetry only",
    blurb:
      "Can send run data and nothing else. Cannot read your workspace, run evals, replay, or manage anything. This is what belongs in an application or a container image.",
    recommended: true,
  },
  {
    key: "ingest",
    label: "Full API access",
    blurb:
      "Sends run data and drives the Bearer-token API — the CI release gate, step replay, whole-run re-execution. Only issue this where those flows actually run.",
  },
];

export default function ApiKeySection({ canAdmin }: { canAdmin: boolean }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [issuedScope, setIssuedScope] = useState<Scope | null>(null);
  const [scope, setScope] = useState<Scope>("trace_write");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/app/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = await res.json();
      if (data.ok) {
        setApiKey(data.apiKey);
        // Report the scope the SERVER issued, not the one requested — if the
        // two ever diverge, the person holding the key should see the truth.
        setIssuedScope((data.scope as Scope) ?? scope);
      } else {
        setError(data.error || "Could not generate key.");
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (!apiKey) return;
    navigator.clipboard?.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!canAdmin) {
    return (
      <div className="appc-card settings-card-full">
        <p className="settings-hint">Ask an owner or admin to generate an ingest key for your workspace.</p>
      </div>
    );
  }

  return (
    <div className="appc-card settings-card-full">
      <p className="settings-hint">
        Your SDK key — set as <code className="mono">RUNBACK_API_KEY</code> in your agent&apos;s environment.
        Keys are shown once; generate a new one any time.
      </p>

      {!apiKey && (
        <div className="key-scope-choice">
          {SCOPES.map((s) => (
            <label key={s.key} className="key-scope" data-selected={scope === s.key || undefined}>
              <input
                type="radio"
                name="key-scope"
                value={s.key}
                checked={scope === s.key}
                onChange={() => setScope(s.key)}
              />
              <span className="key-scope-body">
                <span className="key-scope-label">
                  {s.label}
                  {s.recommended && <span className="key-scope-tag mono">recommended</span>}
                </span>
                <span className="key-scope-blurb">{s.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {error && <p className="settings-hint" role="alert" style={{ color: "var(--rose)" }}>{error}</p>}

      {!apiKey ? (
        <button className="btn-line" onClick={generate} disabled={loading} style={{ alignSelf: "flex-start" }}>
          {loading ? "Generating…" : "Generate API key →"}
        </button>
      ) : (
        <div className="onb-key-row">
          <code className="onb-key mono">{apiKey}</code>
          <button className="btn-line" onClick={copy} style={{ fontSize: "0.82rem", padding: "0.3rem 0.75rem" }}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <span className="onb-key-hint">
            {issuedScope === "trace_write" ? "Telemetry-only key. " : "Full API access. "}
            Save it — shown once. Generate another to rotate.
          </span>
        </div>
      )}
    </div>
  );
}
