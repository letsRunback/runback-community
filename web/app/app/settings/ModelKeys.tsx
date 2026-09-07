"use client";

import { useEffect, useState } from "react";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", hint: "sk-…", where: "platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", hint: "sk-ant-…", where: "console.anthropic.com" },
  { id: "groq", label: "Groq", hint: "gsk_…", where: "console.groq.com/keys" },
] as const;

interface Masked { provider: string; last4: string; updated_at: string }

export default function ModelKeys() {
  const [keys, setKeys] = useState<Masked[]>([]);
  const [provider, setProvider] = useState("openai");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await fetch("/api/settings/model-keys").then((r) => r.json());
      if (d.ok) setKeys(d.keys);
    } catch { /* ignore */ }
  }
  // `load` is also the refresh after save/delete, so it stays a plain function.
  // The effect awaits it rather than calling it bare, keeping every setState in
  // this component behind an await boundary.
  useEffect(() => { void (async () => { await load(); })(); }, []);

  async function save() {
    if (!value.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/settings/model-keys", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, key: value.trim() }),
      }).then((r) => r.json());
      if (d.ok) { setMsg({ ok: true, text: "Saved." }); setValue(""); load(); }
      else setMsg({ ok: false, text: d.error || "Failed." });
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  }

  async function remove(p: string) {
    setBusy(true);
    try { await fetch(`/api/settings/model-keys?provider=${p}`, { method: "DELETE" }); load(); }
    finally { setBusy(false); }
  }

  const current = PROVIDERS.find((p) => p.id === provider)!;
  const have = new Set(keys.map((k) => k.provider));

  return (
    <div className="mk-keys">
      <p className="mk-keys-note">
        Add a provider key to run <strong>live</strong> replays, counterfactuals, and golden-suite
        candidate runs in the managed cloud. Stored encrypted; only the last 4 chars are ever shown.
        Self-hosting? Set <span className="mono">OPENAI_API_KEY</span> / <span className="mono">ANTHROPIC_API_KEY</span> / <span className="mono">GROQ_API_KEY</span> in env instead.
      </p>

      {keys.length > 0 && (
        <ul className="mk-keys-list">
          {keys.map((k) => (
            <li key={k.provider}>
              <span className="mono">{k.provider}</span>
              <span className="mk-keys-mask mono">····{k.last4}</span>
              <button className="mk-keys-rm" onClick={() => remove(k.provider)} disabled={busy}>remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="mk-keys-add">
        <select className="replay-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}{have.has(p.id) ? " (replace)" : ""}</option>)}
        </select>
        <input type="password" placeholder={`Paste your ${current.label} key (${current.hint})`} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        <button className="btn-fill" onClick={save} disabled={busy || !value.trim()}>{busy ? "Saving…" : "Save key"}</button>
      </div>
      <p className="mk-keys-where mono">Get a {current.label} key at {current.where}</p>
      {msg && <p className={msg.ok ? "team-ok" : "gs-error"} style={{ marginTop: "0.4rem" }}>{msg.text}</p>}
    </div>
  );
}
