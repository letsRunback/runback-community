"use client";

import { useEffect, useState } from "react";

/**
 * The bearer token an IdP presents to /api/scim/v2.
 *
 * Shown once and rotated on re-issue — an IdP holds exactly one credential, and
 * leaving old tokens live means a decommissioned connector can still add and
 * remove people.
 */
export default function ScimSection({ canAdmin }: { canAdmin: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The page's own origin, not a hardcoded runback.dev — an IdP admin on a
  // self-hosted deployment pasting the hosted domain here would point their
  // directory sync at the wrong server entirely.
  //
  // Unlike ConnectSnippet's baseUrl (only ever read after a user clicks "Get
  // an API key", well after hydration), this card's "SCIM base URL" line
  // renders unconditionally on mount whenever canAdmin is true — so reading
  // window.location.origin directly during render, as a first attempt at
  // this fix did, made the client's very first render disagree with the
  // server-rendered HTML (https://runback.dev vs. e.g.
  // http://localhost:3000) and threw a real, reproducible React hydration
  // error (#418) on every load of Settings. Rendering the SSR-safe fallback
  // on the initial client render, then correcting it via effect + state
  // (an ordinary post-mount client update, not part of hydration) is the
  // correct fix here — not a shortcut around one.
  const [scimBase, setScimBase] = useState("https://runback.dev");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above: this corrects a value that must be identical to the SSR fallback on the FIRST client render to avoid a hydration mismatch, then updates after mount. That's what the effect is for.
    setScimBase(window.location.origin);
  }, []);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/scim-key", { method: "POST" });
      const data = await res.json();
      if (data.ok) setToken(data.apiKey);
      else setError(data.error || "Could not create a token.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!token) return;
    navigator.clipboard?.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!canAdmin) {
    return (
      <div className="appc-card settings-card-full">
        <p className="settings-hint">Ask an owner or admin to set up directory provisioning.</p>
      </div>
    );
  }

  return (
    <div className="appc-card settings-card-full">
      <p className="settings-hint">
        Connect Okta, Entra ID or any SCIM 2.0 provider so joiners and leavers are provisioned automatically.
        Deprovisioning removes workspace access immediately — no manual offboarding step.
      </p>

      <div className="settings-kv mono">
        <span className="settings-kv-k">SCIM base URL</span>
        <span className="settings-kv-v">{scimBase}/api/scim/v2</span>
      </div>

      {token ? (
        <>
          <p className="settings-hint">
            Copy this now — it is not shown again. Issuing a new token retires the previous one.
          </p>
          <div className="settings-key-row">
            <code className="settings-key mono">{token}</code>
            <button className="btn-line" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </>
      ) : (
        <button className="btn-fill" onClick={issue} disabled={busy}>
          {busy ? "Creating…" : "Create SCIM token"}
        </button>
      )}

      {error && <p className="settings-hint" role="alert">{error}</p>}
    </div>
  );
}
