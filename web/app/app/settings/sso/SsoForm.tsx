"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Cfg { enabled: boolean; issuer: string; clientId: string; hasSecret: boolean; domains: string[]; defaultRole: string }

export default function SsoForm({ initial }: { initial: Cfg }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [issuer, setIssuer] = useState(initial.issuer);
  const [clientId, setClientId] = useState(initial.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [domains, setDomains] = useState(initial.domains.join(", "));
  const [defaultRole, setDefaultRole] = useState(initial.defaultRole);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await fetch("/api/settings/sso", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, issuer, clientId, clientSecret: clientSecret || undefined, domains: domains.split(",").map((d) => d.trim()).filter(Boolean), defaultRole }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok) { setMsg({ ok: true, text: "Saved." }); setClientSecret(""); router.refresh(); }
    else setMsg({ ok: false, text: data.error || "Failed." });
  }

  return (
    <form className="sso-form" onSubmit={save}>
      <label className="sso-field sso-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Enable SSO for this workspace</span>
      </label>

      <label className="sso-field">
        <span>OIDC issuer URL</span>
        <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://your-company.okta.com/oauth2/default" />
        <small>From your IdP. We read its <span className="mono">/.well-known/openid-configuration</span>.</small>
      </label>
      <div className="sso-row">
        <label className="sso-field">
          <span>Client ID</span>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="0oa…" />
        </label>
        <label className="sso-field">
          <span>Client secret {initial.hasSecret && <em>(set — leave blank to keep)</em>}</span>
          <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={initial.hasSecret ? "••••••••" : "secret"} />
        </label>
      </div>
      <div className="sso-row">
        <label className="sso-field">
          <span>Email domains (comma-separated)</span>
          <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="yourcompany.com, eu.yourcompany.com" />
          <small>Users with these domains sign in via your IdP.</small>
        </label>
        <label className="sso-field">
          <span>Default role for new members</span>
          <select value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
            {/* API only accepts "admin" or "member" (POST /api/settings/sso)
                — "viewer" used to be offered here and always got rejected
                with a 422 the moment someone picked it and saved. */}
            {["member", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      <div className="sso-actions">
        <button className="btn-fill" type="submit" disabled={saving}>{saving ? "Saving…" : "Save SSO settings"}</button>
        {msg && <span className={msg.ok ? "team-ok" : "gs-error"}>{msg.text}</span>}
      </div>
    </form>
  );
}
