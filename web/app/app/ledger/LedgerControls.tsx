"use client";

import { useState } from "react";
import Link from "next/link";

const short = (h?: string | null) => (h ? `${h.slice(0, 14)}…${h.slice(-8)}` : "—");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function LedgerControls({ initial }: { initial: any }) {
  const [status, setStatus] = useState(initial);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [verification, setVerification] = useState<any>(null);
  const [busy, setBusy] = useState<"" | "verify" | "seal">("");

  async function call(action: "verify" | "seal") {
    setBusy(action);
    const res = await fetch("/api/app/ledger", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const data = await res.json();
    setBusy("");
    if (!data.ok) { alert(data.error || "Failed."); return; }
    if (action === "verify") setVerification(data.verification);
    else {
      // refresh status after sealing
      const s = await (await fetch("/api/app/ledger")).json();
      if (s.ok) setStatus(s.status);
      setVerification(null);
    }
  }

  const v = verification;
  return (
    <>
      <div className="lg-hero">
        <div className="lg-hero-num">{status.count.toLocaleString()}</div>
        <div className="lg-hero-body">
          <div className="lg-hero-label">decisions sealed into the chain</div>
          <p className="lg-hero-sub">
            Every one is re-derivable from its current data — click Verify and this
            re-checks all {status.count.toLocaleString()} of them against the last signed checkpoint, live.
          </p>
        </div>
        <button className="btn-fill lg-hero-cta" onClick={() => call("verify")} disabled={!!busy}>
          {busy === "verify" ? "Verifying…" : "Verify integrity →"}
        </button>
      </div>

      <div className="lg-stat">
        <div className="lg-stat-cell" data-sealed={!!status.head || undefined}>
          <div className="lg-k mono">Chain head</div>
          <div className="lg-v mono lg-hash">{short(status.head)}</div>
        </div>
        <div className="lg-link" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M8 12a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-.5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M12 8a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l.5-.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>chained</span>
        </div>
        <div className="lg-stat-cell" data-sealed={status.signed || undefined}>
          <div className="lg-k mono">Signed checkpoint</div>
          <div className="lg-v">{status.sealedThrough ? `seq ${status.sealedThrough}${status.signed ? " · signed" : ""}` : "none yet"}</div>
        </div>
      </div>

      <div className="lg-actions">
        <button className="btn-line" onClick={() => call("seal")} disabled={!!busy}>{busy === "seal" ? "Sealing…" : "Seal a checkpoint"}</button>
      </div>

      {v && (
        <div className={`lg-verdict ${v.intact === null ? "unknown" : v.intact ? "ok" : "bad"}`}>
          {/* Three states, not two. `v.intact ? ok : bad` rendered "could not
              verify" (null) as "✗ Tamper detected" — announcing evidence
              tampering because a query failed. Unknown is not a finding. */}
          <div className="lg-verdict-head">
            <strong>
              {v.intact === null
                ? "? Could not verify"
                : v.intact
                  ? "✓ Ledger intact"
                  : "✗ Tamper detected"}
            </strong>
            <span className="mono">{v.count.toLocaleString()} entries</span>
          </div>
          <p className="lg-note">{v.note}</p>
          {v.brokenAt && (
            <div className="lg-broken mono">seq {v.brokenAt.seq} · <Link href={`/app/runs/${v.brokenAt.run_id}`} className="appc-link">{v.brokenAt.run_id}</Link></div>
          )}
          {v.checkpoint && (
            <div className="lg-cp mono">
              checkpoint seq {v.checkpoint.seq}:
              <span data-ok={v.checkpoint.matchesHead || undefined} data-bad={!v.checkpoint.matchesHead || undefined}> head {v.checkpoint.matchesHead ? "✓" : "✗"}</span>
              <span data-ok={v.checkpoint.matchesRoot || undefined} data-bad={!v.checkpoint.matchesRoot || undefined}> · merkle root {v.checkpoint.matchesRoot ? "✓" : "✗"}</span>
              <span data-ok={v.checkpoint.signatureValid || undefined} data-bad={!v.checkpoint.signatureValid || undefined}> · signature {v.checkpoint.signatureValid ? "✓" : "unsigned/✗"}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
