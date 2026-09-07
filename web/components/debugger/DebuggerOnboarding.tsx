"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "sb_onboarded_v1";

/** One-time intro that teaches how to read a run. Re-openable via the header "?". */
export default function DebuggerOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // One-shot read of a client-only store on mount; can't run during SSR render.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      /* ignore */
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="ob-scrim" role="dialog" aria-modal="true" onClick={dismiss}>
      <div className="ob-card" onClick={(e) => e.stopPropagation()}>
        <div className="ob-eyebrow">Time-travel replay</div>
        <h2 className="ob-title">Replay this agent run — scrubbable in time.</h2>

        <ul className="ob-list">
          <li>
            <span className="ob-dot" style={{ background: "var(--blue)" }} />
            <div>
              <b>Scrub the run.</b> Drag the slider or use{" "}
              <kbd className="key">←</kbd> <kbd className="key">→</kbd>. Rewind to
              before it broke and watch what the agent knew at each step.
            </div>
          </li>
          <li>
            <span className="ob-dot" style={{ background: "var(--emerald)" }} />
            <div>
              <b>Deterministic &amp; offline.</b> Reconstructed from the recording —
              no model calls, nothing leaves this machine.
            </div>
          </li>
          <li>
            <span className="ob-dot" style={{ background: "var(--violet)" }} />
            <div>
              <b>Need step detail?</b> Switch to <i>Inspect</i> for the exact
              context, response, and replay of any single step.
            </div>
          </li>
        </ul>

        <div className="ob-actions">
          <button className="replay-btn" onClick={dismiss}>
            Got it
          </button>
          <Link href="/how-it-works" className="replay-btn ghost" onClick={dismiss}>
            Full guide →
          </Link>
        </div>
      </div>
    </div>
  );
}
