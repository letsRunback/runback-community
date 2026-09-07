"use client";

import { useEffect, useState } from "react";

interface Sink {
  id: string;
  kind: string;
  endpoint: string;
  enabled: boolean;
  cursor_seq: number;
  last_ok_at: string | null;
  last_error: string | null;
}

const KINDS = [
  { id: "splunk_hec", label: "Splunk (HEC)", hint: "https://http-inputs-<host>.splunkcloud.com/services/collector",
    credential: "HEC token" },
  // Sentinel's Logs Ingestion API takes an Entra-issued access token that
  // expires hourly, so a pasted bearer token stops working the same day. We
  // take the client credentials and mint the token per batch instead — the
  // field has to say so, or the customer supplies the wrong thing and finds out
  // when their audit feed silently stops.
  { id: "sentinel", label: "Microsoft Sentinel", hint: "https://<workspace>.ingest.monitor.azure.com/dataCollectionRules/…",
    credential: "tenantId:clientId:clientSecret" },
  { id: "webhook", label: "Generic HTTPS collector", hint: "https://collector.example.com/ingest",
    credential: "Bearer token" },
];

/**
 * Forward the administrative audit log to the customer's security monitoring.
 *
 * Surfaces last_error prominently: the failure mode this feature exists to
 * avoid is a feed that quietly stops, which looks identical to "nothing has
 * happened" unless the error is shown.
 */
export default function SiemExport({ canAdmin }: { canAdmin: boolean }) {
  const [sink, setSink] = useState<Sink | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState("splunk_hec");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const d = await fetch("/api/app/siem").then((r) => r.json());
    if (d.ok) {
      setSink(d.sink);
      if (d.sink) { setKind(d.sink.kind); setEndpoint(d.sink.endpoint); }
    } else setError(d.error);
    setLoaded(true);
  }
  useEffect(() => { void (async () => { await load(); })(); }, []);

  async function save() {
    setBusy(true); setError(null);
    const d = await fetch("/api/app/siem", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, endpoint, token: token || undefined }),
    }).then((r) => r.json());
    setBusy(false);
    if (d.ok) { setToken(""); await load(); } else setError(d.error);
  }

  async function remove() {
    if (!confirm("Stop forwarding audit events to your SIEM?")) return;
    setBusy(true); setError(null);
    const d = await fetch("/api/app/siem", { method: "DELETE" }).then((r) => r.json());
    setBusy(false);
    if (d.ok) { setSink(null); setEndpoint(""); } else setError(d.error);
  }

  if (!canAdmin) {
    return (
      <div className="appc-card settings-card-full">
        <p className="settings-hint">Ask an owner or admin to configure SIEM export.</p>
      </div>
    );
  }

  return (
    <div className="appc-card settings-card-full">
      <p className="settings-hint">
        Forward every administrative action — key issuance, role changes, SSO edits, legal holds — to your security
        monitoring, hourly. Each event carries its chain hashes so you can verify the feed was not altered in transit.
      </p>

      {sink?.last_error && (
        <p className="settings-hint" role="alert">
          Last delivery failed: {sink.last_error}
        </p>
      )}
      {sink && !sink.last_error && sink.last_ok_at && (
        <p className="settings-hint">
          Last delivered {new Date(sink.last_ok_at).toLocaleString()} · up to entry #{sink.cursor_seq}
        </p>
      )}

      <div className="settings-key-row">
        <select className="settings-input" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <input
          className="settings-input" placeholder={KINDS.find((k) => k.id === kind)?.hint}
          value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
        />
        <input
          className="settings-input" type="password"
          placeholder={
            sink
              ? `${KINDS.find((k) => k.id === kind)?.credential} (leave blank to keep)`
              : KINDS.find((k) => k.id === kind)?.credential
          }
          value={token} onChange={(e) => setToken(e.target.value)}
        />
        <button className="btn-fill" onClick={save} disabled={busy}>{sink ? "Update" : "Connect"}</button>
        {sink && <button className="btn-line" onClick={remove} disabled={busy}>Remove</button>}
      </div>

      {error && <p className="settings-hint" role="alert">{error}</p>}
      {loaded && !sink && !error && (
        <p className="settings-hint">Not connected — audit events stay in Runback only.</p>
      )}
    </div>
  );
}
