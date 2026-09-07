"use client";

/**
 * The hero reel — a self-driving loop of the whole value story. No clicks: it
 * plays observe → replay → gate → prove on repeat, so a visitor watches what the
 * platform does instead of reading about it. Each act is a small, on-brand scene;
 * the reel cross-fades between them and shows progress along the four acts.
 */
import { useEffect, useState } from "react";

const ACTS = ["Observe", "Replay", "Gate", "Prove"] as const;
const DURATION = 3800;

export default function HeroReel() {
  const [act, setAct] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setAct((a) => (a + 1) % ACTS.length), DURATION);
    return () => clearTimeout(t);
  }, [act, paused]);

  return (
    <div
      className="reel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Runback in motion: observe, replay, gate, prove"
    >
      {/* Acts header */}
      <div className="reel-acts">
        {ACTS.map((a, i) => (
          <button key={a} className="reel-act" data-on={i === act || undefined} onClick={() => setAct(i)}>
            <span className="reel-act-dot" />
            <span className="reel-act-label">{a}</span>
            {i === act && <span className="reel-act-bar" key={`bar-${act}-${paused}`} data-paused={paused || undefined} />}
          </button>
        ))}
      </div>

      {/* Stage */}
      <div className="reel-stage">
        {act === 0 && <Observe />}
        {act === 1 && <Replay />}
        {act === 2 && <Gate />}
        {act === 3 && <Prove />}
      </div>

      <div className="reel-caption">{CAPTIONS[act]}</div>
    </div>
  );
}

const CAPTIONS = [
  "Every decision your agents make — captured.",
  "Re-run any decision, on any model — see what changes.",
  "Gate releases against policy — catch the regression before it ships.",
  "A signed, sealed record nothing can alter.",
];

function Observe() {
  const rows = [
    { g: "▸", t: "support-refund-agent", m: "run", s: "run" },
    { g: "◇", t: "agent reasons over the dispute", m: "gpt-4o", s: "ok" },
    { g: "↳", t: "lookup_customer", m: "gold tier", s: "ok" },
    { g: "◇", t: "decide → issue_refund $250", m: "gpt-4o", s: "ok" },
    { g: "✗", t: "policy breach — disputed, no escalation", m: "blocked", s: "fail" },
  ];
  return (
    <div className="sc sc-observe">
      {rows.map((r, i) => (
        <div className="sc-row" data-s={r.s} key={i} style={{ animationDelay: `${i * 0.45}s` }}>
          <span className="sc-g mono">{r.g}</span>
          <span className="sc-t">{r.t}</span>
          <span className="sc-m mono">{r.m}</span>
        </div>
      ))}
    </div>
  );
}

function Replay() {
  return (
    <div className="sc sc-replay">
      <div className="sc-then">
        <div className="sc-h mono">Then · gpt-4o</div>
        <p>“Gold tier — issuing the $250 refund.”</p>
        <div className="sc-verdict bad">issue_refund · policy breach</div>
      </div>
      <div className="sc-arrow mono">replay</div>
      <div className="sc-now">
        <div className="sc-h mono">Now · re-run</div>
        <p>“Disputed and over the limit — routing to a human.”</p>
        <div className="sc-verdict ok">escalate_to_human · within policy</div>
      </div>
    </div>
  );
}

function Gate() {
  const checks = [
    { t: "refund ≤ $100 limit", ok: true },
    { t: "stays within disclosure policy", ok: true },
    { t: "disputed charge → must escalate", ok: false },
  ];
  return (
    <div className="sc sc-gate">
      {checks.map((c, i) => (
        <div className="sc-check" data-ok={c.ok || undefined} key={i} style={{ animationDelay: `${i * 0.4}s` }}>
          <span className="sc-check-g mono">{c.ok ? "✓" : "✗"}</span>
          <span>{c.t}</span>
        </div>
      ))}
      <div className="sc-gate-foot mono">release blocked — 1 regression caught pre-deploy</div>
    </div>
  );
}

function Prove() {
  return (
    <div className="sc sc-prove">
      <div className="sc-seal">✓</div>
      <div className="sc-prove-rows">
        <div className="sc-prove-row"><span className="mono k">record</span><span className="mono v">runback.audit/v1</span></div>
        <div className="sc-prove-row"><span className="mono k">digest</span><span className="mono v">3e68cdbb…df98</span></div>
        <div className="sc-prove-row"><span className="mono k">signature</span><span className="mono v sc-sig">Ed25519 ✓</span></div>
        <div className="sc-prove-row"><span className="mono k">ledger</span><span className="mono v sc-sig">sealed · intact</span></div>
      </div>
    </div>
  );
}
