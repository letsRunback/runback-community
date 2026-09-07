"use client";

import { useState } from "react";
import Link from "next/link";

/** Shape returned by POST /api/app/fleet-determinism as `result`. */
interface DeterminismResult {
  rate: number;
  reproduced: number;
  diverged: number;
  unverifiable: number;
  failures: { run_id: string; name: string | null }[];
}

export default function FleetDeterminism() {
  const [r, setR] = useState<DeterminismResult | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/app/fleet-determinism", { method: "POST" });
      const data = await res.json();
      // Every non-ok outcome must say something. This previously did
      // `if (data.ok) setR(...)` with no else, so a 402 (deep-replay not on this
      // plan), a 401, or a 500 all rendered as the button quietly resetting —
      // indistinguishable from a no-op click.
      if (!res.ok || !data.ok) {
        setErr(data.error || `Could not verify determinism (HTTP ${res.status}).`);
        return;
      }
      setR(data.result);
    } catch {
      setErr("Network error — could not reach the verifier.");
    } finally {
      setLoading(false);
    }
  }

  const pct = r ? Math.round(r.rate * 100) : 0;
  return (
    <div className="fd">
      <div className="fd-main">
        <div className="fd-k mono">Fleet determinism</div>
        {!r ? (
          <p className="fd-p">Re-execute your recent runs and prove they reproduce — deterministically, from the recording. The signal a big org actually asks for.</p>
        ) : (
          <p className="fd-p">
            <strong className="mono" data-tone={pct === 100 ? "ok" : "warn"}>{r.reproduced}/{r.reproduced + r.diverged} runs re-execute deterministically</strong>
            {" "}({pct}%){r.unverifiable ? <span className="fd-dim"> · {r.unverifiable} pre-digest, skipped</span> : null}.
            {r.diverged > 0 && r.failures[0] && <> First divergence: <Link href={`/app/runs/${r.failures[0].run_id}`} className="appc-link mono">{r.failures[0].name || r.failures[0].run_id}</Link>.</>}
          </p>
        )}
      </div>
      <button className="btn-line" onClick={run} disabled={loading}>{loading ? "Re-executing…" : r ? "Re-check" : "Verify fleet determinism"}</button>
      {err && <p className="gs-error fd-err">{err}</p>}
    </div>
  );
}
