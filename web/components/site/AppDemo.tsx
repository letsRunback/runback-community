"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";

// ── Step 5 CSS scene — regulatory proof ──────────────────────────────────────

function ProveScene() {
  return (
    <div className="appdemo-css">
      <div className="appdemo-css-topbar">
        <span className="appdemo-css-tag emerald-tag">live · computed now</span>
        <span className="appdemo-css-id mono">Regulatory dashboard · 1,241 runs analysed</span>
      </div>
      <div className="appdemo-css-regs">
        {([
          { label: "EU AI Act · Art. 12", detail: "Mandatory logging & traceability", ok: true },
          { label: "APRA CPS 230",         detail: "Operational incident recording",   ok: true },
          { label: "NIST AI RMF",          detail: "Govern · Map · Measure · Manage",  ok: true },
          { label: "ISO/IEC 42001",        detail: "AI management system",             ok: false, warn: "Enterprise" },
        ]).map((r) => (
          <div key={r.label} className="appdemo-css-regrow">
            <div>
              <div className="mono appdemo-css-regname">{r.label}</div>
              <div className="appdemo-css-regdet">{r.detail}</div>
            </div>
            <span className={`appdemo-css-regbadge${r.ok ? "" : " dim"}`}>
              {r.ok ? "✓ covered" : r.warn}
            </span>
          </div>
        ))}
      </div>
      <div className="appdemo-css-regfoot mono">
        Export signed audit artifact — verifiable without Runback →
      </div>
    </div>
  );
}

// ── 5-step narrative ──────────────────────────────────────────────────────────

type Step = {
  n: string;
  label: string;
  title: string;
  sub: string;
  tone: string;
} & ({ kind: "image"; img: string } | { kind: "css" });

const STEPS: Step[] = [
  {
    n: "01", label: "Observe", tone: "rose", kind: "image", img: "/runs.png",
    title: "Alert fires. Every run captured automatically.",
    sub: "ERROR runs surface instantly. Open any run to see exactly what happened — no log hunting.",
  },
  {
    n: "02", label: "Debug", tone: "rose", kind: "image", img: "/run-trace.png",
    title: "Root cause — highlighted, not hunted.",
    sub: "Click the failure step. See the exact messages[] the model was given. 2 minutes, not 2 hours.",
  },
  {
    n: "03", label: "Replay", tone: "violet", kind: "image", img: "/run-trace-scroll.png",
    title: "Re-run from the exact captured context.",
    sub: "Hold tools and retrieval fixed. Swap the model. Different output? You found the regression.",
  },
  {
    n: "04", label: "Gate", tone: "amber", kind: "image", img: "/policies.png",
    title: "Simulate 90 days of decisions. Ship with confidence.",
    sub: "Write a rule. Backtest against real decisions. Enforce live — the block is sealed into the record.",
  },
  {
    n: "05", label: "Prove", tone: "emerald", kind: "css",
    title: "Signed, sealed, verifiable by anyone.",
    sub: "EU AI Act Art. 12, APRA CPS 230, NIST AI RMF — computed live from your actual run data.",
  },
];

const INTERVAL = 5000;
const FADE_MS  = 380;

// ── Component ─────────────────────────────────────────────────────────────────

export default function AppDemo() {
  const [idx, setIdx]           = useState(0);
  const [paused, setPaused]     = useState(false);
  const [progress, setProgress] = useState(0);

  const goTo = useCallback((next: number) => {
    setIdx(next);
    setProgress(0);
  }, []);

  useEffect(() => {
    if (paused) return;
    const step = 50;
    const inc = (step / INTERVAL) * 100;
    const t = setInterval(() => setProgress((p) => Math.min(p + inc, 100)), step);
    return () => clearInterval(t);
  }, [idx, paused]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => goTo((idx + 1) % STEPS.length), INTERVAL);
    return () => clearInterval(t);
  }, [idx, paused, goTo]);

  const step = STEPS[idx];

  return (
    <div
      className="appdemo"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Step tabs */}
      <div className="appdemo-step-nav">
        {STEPS.map((s, i) => (
          <button
            key={s.n}
            className={`appdemo-step-tab${i === idx ? " active" : ""}`}
            data-tone={i === idx ? s.tone : undefined}
            onClick={() => { goTo(i); setPaused(true); setTimeout(() => setPaused(false), 10_000); }}
            aria-current={i === idx ? "step" : undefined}
          >
            <span className="appdemo-step-n mono">{s.n}</span>
            <span className="appdemo-step-label">{s.label}</span>
            {i === idx && (
              <span
                className="appdemo-step-progress"
                style={{ width: `${progress}%`, transition: paused ? "none" : "width 50ms linear" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Browser chrome */}
      <div className="appdemo-chrome">
        <div className="appdemo-dots-chrome"><span /><span /><span /></div>
        <div className="appdemo-url mono">runback.dev/app/runs</div>
      </div>

      {/* Scene frame */}
      <div className="appdemo-frame">
        {STEPS.map((s, i) => (
          <div
            key={i}
            className="appdemo-layer"
            style={{ opacity: i === idx ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}
          >
            {s.kind === "image" ? (
              <Image
                src={s.img}
                alt={s.title}
                fill
                sizes="(max-width: 980px) 100vw, 920px"
                quality={95}
                style={{ objectFit: "cover", objectPosition: "top left" }}
                priority={i === 0}
              />
            ) : (
              <ProveScene />
            )}
          </div>
        ))}

        {/* Caption */}
        <div className="appdemo-caption" key={`cap-${idx}`}>
          <div className="appdemo-caption-label">{step.title}</div>
          <div className="appdemo-caption-sub">{step.sub}</div>
        </div>

        {/* Progress bar */}
        <div className="appdemo-progress">
          <div
            className="appdemo-progress-fill"
            style={{ width: `${progress}%`, transition: paused ? "none" : "width 50ms linear" }}
          />
        </div>
      </div>

      {/* CTA on last step */}
      {idx === STEPS.length - 1 && (
        <div className="appdemo-cta-row">
          <Link href="/how-it-works" className="btn-line btn-sm">Walk the full incident →</Link>
          <Link href="/demo" className="btn-fill btn-sm">Book a 30-min demo</Link>
        </div>
      )}
    </div>
  );
}
