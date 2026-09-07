"use client";

import { useState } from "react";
import { useReplayModels } from "@/lib/replay/useReplayModels";
import { REPLAY_MODELS } from "@/lib/replay/models";

const short = (h?: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Verify = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Counter = any;

export default function WholeRunReplay({ runId, capturedModel }: { runId: string; capturedModel: string }) {
  const models = useReplayModels();
  const [verify, setVerify] = useState<Verify | null>(null);
  const [vLoading, setVLoading] = useState(false);
  const [model, setModel] = useState(REPLAY_MODELS.find((m) => m !== capturedModel) || REPLAY_MODELS[0]);
  // The initial value is seeded from the build-time list, which on an
  // air-gapped deployment may name a model this site cannot reach. Derive the
  // effective choice during render rather than correcting state in an effect:
  // the stored value stays whatever the user picked, and the one that is sent
  // is always a model this deployment actually serves.
  const selectedModel = models.includes(model) ? model : (models[0] ?? model);
  const [counter, setCounter] = useState<Counter | null>(null);
  const [cLoading, setCLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [bisectR, setBisectR] = useState<any>(null);
  const [bLoading, setBLoading] = useState(false);
  const [bisectDemo, setBisectDemo] = useState(false);
  const [err, setErr] = useState("");

  async function bisect() {
    setErr("");
    setBLoading(true);
    try {
      const res = await fetch(`/api/runs/${runId}/bisect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidates: models }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Failed."); return; }
      setBisectR(data.result);
      setBisectDemo(!!data.demo);
    } catch { setErr("Network error."); }
    finally { setBLoading(false); }
  }

  async function run(mode: "verify" | "counterfactual") {
    setErr("");
    const setL = mode === "verify" ? setVLoading : setCLoading;
    setL(true);
    try {
      const res = await fetch(`/api/runs/${runId}/reexecute`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "verify" ? { mode } : { mode, model: selectedModel }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Failed."); return; }
      if (mode === "verify") setVerify(data.result); else setCounter(data.result);
    } catch { setErr("Network error."); }
    finally { setL(false); }
  }

  return (
    <section className="wrr">
      <div className="wrr-head">
        <div>
          <h3 className="wrr-title">Whole-run replay</h3>
          <p className="wrr-sub">Re-execute the entire run — verify it reproduces deterministically, or replay it on another model to see where its decisions diverge.</p>
        </div>
      </div>

      <div className="wrr-grid">
        {/* Verify */}
        <div className="wrr-card">
          <div className="wrr-k mono">Re-execute &amp; verify</div>
          <p className="wrr-p">Replays the recorded oracle stream and checks it reproduces the digest captured at ingest. Deterministic — no model calls.</p>
          <button className="btn-line" onClick={() => run("verify")} disabled={vLoading}>{vLoading ? "Re-executing…" : "Re-execute this run"}</button>
          {verify && (
            <div className={`wrr-verdict ${verify.ok ? "ok" : "bad"}`}>
              <strong>{verify.ok ? "✓ Reproduced" : "✗ Did not reproduce"}</strong>
              <span className="mono">{verify.steps} steps · {verify.attestedDigest ? "digest verified" : "no attested digest"}</span>
              <div className="wrr-digest mono">{short(verify.reproducedDigest)}</div>
              {!verify.ok && verify.divergedAt && <div className="wrr-diverge mono">{verify.divergedAt.label}</div>}
            </div>
          )}
        </div>

        {/* Counterfactual */}
        <div className="wrr-card">
          <div className="wrr-k mono">Replay on another model</div>
          <p className="wrr-p">Re-runs the whole run on a different model — continues <em>past</em> the first divergence, reusing recorded tool outputs by content, and shows every step that would change.</p>
          <div className="wrr-row">
            <select className="replay-select" value={selectedModel} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => <option key={m} value={m}>{m}{m === capturedModel ? "  (captured)" : ""}</option>)}
            </select>
            <button className="btn-fill" onClick={() => run("counterfactual")} disabled={cLoading}>{cLoading ? "Replaying…" : "Replay whole run"}</button>
          </div>
          {counter && (
            <div className={`wrr-verdict ${counter.frontier ? "warn" : "ok"}`}>
              <strong>
                {counter.frontier
                  ? `Reproduces ${counter.reproducedPrefix}/${counter.totalLlmSteps}, then forks at step ${counter.frontier.seq}`
                  : "Reproduces every decision"}
              </strong>
              <span className="mono">
                {counter.divergedSteps}/{counter.totalLlmSteps} decisions differ · {counter.toolsServedFromCassette} tool output{counter.toolsServedFromCassette === 1 ? "" : "s"} reused · {counter.toolsNeedingLive} live-needed
              </span>
              {Array.isArray(counter.steps) && counter.steps.length > 0 && (
                <div className="wrr-steps">
                  {counter.steps.map((s: { seq: number; outcome: string }) => (
                    <span key={s.seq} className="wrr-step" data-o={s.outcome} title={`step ${s.seq}: ${s.outcome}`} />
                  ))}
                </div>
              )}
              <p className="wrr-vtext">{counter.verdict}</p>
              {counter.frontier && (
                <div className="wrr-cf">
                  <div><span className="wrr-cf-k mono">recorded</span><span>{counter.frontier.recorded}</span></div>
                  <div><span className="wrr-cf-k mono" data-cf>{selectedModel}</span><span>{counter.frontier.counterfactual}</span></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bisect — find the change that flipped this run, in log₂ probes */}
      <div className="wrr-card wrr-bisect">
        <div className="wrr-k mono">Bisect the timeline</div>
        <p className="wrr-p">Binary-search an ordered candidate list (a model-upgrade or prompt timeline) for the exact change that flips this run&apos;s decisions — in log₂ probes, not one-by-one.</p>
        <button className="btn-line" onClick={bisect} disabled={bLoading}>{bLoading ? "Bisecting…" : `Bisect ${models.length} candidates`}</button>
        {bisectR && (
          <div className={`wrr-verdict ${bisectR.firstBadIndex === null ? "ok" : "warn"}`}>
            <strong>{bisectR.firstBadIndex === null ? "No regression across the list" : `Culprit: ${bisectR.culprit}`}</strong>
            <span className="mono">{bisectR.comparisons} probe{bisectR.comparisons === 1 ? "" : "s"} across {bisectR.count} candidates{bisectDemo ? " · simulated" : ""}</span>
            <p className="wrr-vtext">{bisectR.verdict}</p>
            <div className="wrr-bstrip">
              {bisectR.labels.map((label: string, i: number) => {
                const probe = bisectR.probes.find((p: { index: number }) => p.index === i);
                const state =
                  i === bisectR.firstBadIndex ? "culprit"
                  : probe ? (probe.good ? "good" : "bad")
                  : bisectR.firstBadIndex !== null && i > bisectR.firstBadIndex ? "bad-implied" : "good-implied";
                return <span key={i} className="wrr-bchip mono" data-s={state} title={`${label}${probe ? " (probed)" : ""}`}>{label}</span>;
              })}
            </div>
          </div>
        )}
      </div>

      {err && <p className="gs-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
    </section>
  );
}
