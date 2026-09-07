"use client";

import { useState } from "react";

/* ──────────────────────────────────────────────────────────────────────────
   Interactive trace explorer for the marketing site. Click any step to drill
   into what the model actually saw, the tool I/O, or the error — so a visitor
   experiences the "go deep inside every step" value prop directly. Dummy data;
   pass a `scenario` to reuse it with a different story on another page.
   ────────────────────────────────────────────────────────────────────────── */

export type DetailBlock = {
  role?: string;
  label?: string;
  body: string;
  tone?: "normal" | "rose" | "muted";
};
export type TraceStep = {
  glyph: string;
  kind: "user" | "llm" | "tool" | "fail";
  label: string;
  meta?: string;
  detailKind: string;
  rows?: { k: string; v: string }[];
  blocks?: DetailBlock[];
  error?: string;
};
export type TraceScenario = {
  title: string;
  status: "failed" | "success";
  steps: TraceStep[];
};

const DEFAULT: TraceScenario = {
  title: "research-email-agent · run failed",
  status: "failed",
  steps: [
    {
      glyph: "›", kind: "user", label: "Research Next.js 16, email me a summary",
      detailKind: "User request",
      blocks: [{ label: "input", body: "Research the Next.js 16 release and email me a one-paragraph summary." }],
    },
    {
      glyph: "●", kind: "llm", label: "agent thinks", meta: "740 tok",
      detailKind: "Model step · the context it saw",
      rows: [{ k: "model", v: "gpt-4o" }, { k: "finish", v: "tool-call" }],
      blocks: [
        { role: "system", body: "You are a research assistant. Search the web, then email the user a summary." },
        { role: "assistant", body: "I'll search the web for the Next.js 16 release notes.", tone: "muted" },
      ],
    },
    {
      glyph: "→", kind: "tool", label: "web_search", meta: "✓",
      detailKind: "Tool call · web_search",
      rows: [{ k: "latency", v: "612 ms" }],
      blocks: [
        { label: "input", body: '{ "query": "Next.js 16 release notes" }' },
        { label: "output", body: "3 results — nextjs.org/blog/next-16, Turbopack stable, cache components…" },
      ],
    },
    {
      glyph: "●", kind: "llm", label: "agent thinks", meta: "998 tok",
      detailKind: "Model step · the context it saw",
      rows: [{ k: "model", v: "gpt-4o" }, { k: "finish", v: "tool-call" }],
      blocks: [
        { role: "system", body: "You are a research assistant. Search the web, then email the user a summary." },
        { role: "tool", body: "web_search → 3 results about the Next.js 16 release.", tone: "muted" },
        { role: "assistant", body: 'Summary ready. Calling send_email(to: "alex[at]acme.co").' },
      ],
    },
    {
      glyph: "→", kind: "fail", label: "send_email", meta: "✗",
      detailKind: "Tool call · send_email — failed here",
      rows: [{ k: "tool", v: "send_email" }, { k: "status", v: "error" }],
      blocks: [{ label: "input", body: '{ "to": "alex[at]acme.co", "body": "Next.js 16 summary…" }', tone: "rose" }],
      error: "Invalid recipient — the model wrote the address in plain text (\"[at]\") instead of a valid email. The run failed here.",
    },
  ],
};

export default function InteractiveTrace({ scenario = DEFAULT }: { scenario?: TraceScenario }) {
  // Open on the failure (like the real product), else the last step.
  const failIdx = scenario.steps.findIndex((s) => s.kind === "fail");
  const [sel, setSel] = useState(failIdx >= 0 ? failIdx : scenario.steps.length - 1);
  const step = scenario.steps[sel];

  return (
    <div className="itrace">
      <div className="itrace-bar">
        <span className="itrace-dot" data-status={scenario.status} />
        <span className="mono">{scenario.title}</span>
        <span className="itrace-hint mono">click any step ↓</span>
      </div>

      <div className="itrace-body">
        <div className="itrace-rail" role="tablist" aria-label="Run steps">
          {scenario.steps.map((s, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === sel}
              className="itrace-step"
              data-kind={s.kind}
              data-selected={i === sel}
              onClick={() => setSel(i)}
            >
              <span className="g">{s.glyph}</span>
              <span className="lbl">{s.label}</span>
              {s.meta && <span className="mt mono">{s.meta}</span>}
            </button>
          ))}
        </div>

        <div className="itrace-detail" key={sel}>
          <div className="itd-kind mono">{step.detailKind}</div>

          {step.rows && step.rows.length > 0 && (
            <dl className="itd-kv">
              {step.rows.map((r) => (
                <div key={r.k} className="itd-kvrow">
                  <dt className="mono">{r.k}</dt>
                  <dd className="mono">{r.v}</dd>
                </div>
              ))}
            </dl>
          )}

          {step.blocks?.map((b, i) => (
            <div key={i} className="itd-block" data-tone={b.tone ?? "normal"}>
              {(b.role || b.label) && (
                <div className="itd-block-h mono" data-role={b.role}>{b.role ?? b.label}</div>
              )}
              <div className="itd-block-body">{b.body}</div>
            </div>
          ))}

          {step.error && <div className="itd-error">{step.error}</div>}
        </div>
      </div>
    </div>
  );
}
