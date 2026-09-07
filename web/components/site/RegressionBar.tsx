"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Gate, at scale — one honest bar instead of a paragraph. The "Gate" job card
 * already shows one policy check; this shows the same mechanism applied to a
 * whole history of decisions, which is the actual pitch for a model/prompt
 * upgrade: not "does it pass one test" but "what does it do differently
 * across everything you've already shipped."
 *
 * Illustrative example, not a customer statistic — we're too early for one
 * (matching the incident walkthrough elsewhere on the site). The reveal
 * below is deliberately restrained for that reason: it animates the same
 * honest numbers into view, it doesn't dress them up as a real result.
 */
const TOTAL = 1000;
const PASS = 972;
const CHANGED = 21;
const BLOCKED = 7;

function useCountUp(target: number, active: boolean, duration = 900) {
  const [value, setValue] = useState(active ? target : 0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return value;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function RegressionBar() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(prefersReducedMotion);

  useEffect(() => {
    if (active) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActive(true);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.4 }
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pass = useCountUp(PASS, active);
  const changed = useCountUp(CHANGED, active);
  const blocked = useCountUp(BLOCKED, active);

  return (
    <div className="rb-wrap" ref={ref}>
      <div className="rb-setup">
        <span className="rb-setup-swap"><span className="mono">GPT-5.4</span> <span className="rb-setup-arrow">→</span> <span className="mono">GPT-5.6</span></span>
        <span className="rb-setup-desc">Replaying 1,000 production decisions</span>
      </div>
      <div
        className={`rb-bar${active ? " is-active" : ""}`}
        role="img"
        aria-label={`${PASS} passed, ${CHANGED} changed, ${BLOCKED} blocked, out of ${TOTAL} replayed decisions`}
      >
        <div className="rb-seg" data-k="pass" style={{ width: active ? `${(PASS / TOTAL) * 100}%` : "0%" }} />
        <div className="rb-seg" data-k="changed" style={{ width: active ? `${(CHANGED / TOTAL) * 100}%` : "0%" }} />
        <div className="rb-seg" data-k="blocked" style={{ width: active ? `${(BLOCKED / TOTAL) * 100}%` : "0%" }} />
      </div>
      <div className="rb-legend">
        <span className="rb-legend-item"><span className="rb-legend-dot" data-k="pass" /><span className="rb-legend-num">{pass}</span> reproduced</span>
        <span className="rb-legend-item"><span className="rb-legend-dot" data-k="changed" /><span className="rb-legend-num">{changed}</span> changed</span>
        <span className="rb-legend-item"><span className="rb-legend-dot" data-k="blocked" /><span className="rb-legend-num">{blocked}</span> would breach policy</span>
      </div>
      <div className="rb-verdict">7 of 1,000 real decisions would breach policy on the candidate model — don&apos;t ship</div>
    </div>
  );
}
