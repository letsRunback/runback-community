"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const NAV = [
  {
    group: "Getting Started",
    items: [
      { id: "overview", label: "Overview" },
      { id: "quickstart", label: "Quick start (5 min)" },
      { id: "first-run", label: "Your first run" },
    ],
  },
  {
    group: "Core Concepts",
    items: [
      { id: "concepts-runs", label: "Runs & spans" },
      { id: "concepts-replay", label: "Replay" },
      { id: "concepts-policies", label: "Policies" },
      { id: "concepts-evals", label: "Evals & CI gate" },
      { id: "concepts-golden", label: "Golden corpus" },
      { id: "concepts-prompts", label: "Prompts" },
    ],
  },
  {
    group: "Approvals & Incidents",
    items: [
      { id: "approvals", label: "Approvals" },
      { id: "incidents", label: "Incidents" },
      { id: "trust-chain", label: "Trust chain" },
    ],
  },
  {
    group: "Connect Your Agent",
    items: [
      { id: "sdk-vercel", label: "Vercel AI SDK" },
      { id: "sdk-manual", label: "Manual recording" },
      { id: "sdk-go", label: "Go (preview)" },
      { id: "sdk-otel", label: "OpenTelemetry" },
      { id: "sdk-python", label: "Python (OpenAI / Anthropic)" },
      { id: "sdk-langchain", label: "LangGraph / LangChain" },
      { id: "sdk-openai-agents", label: "OpenAI Agents SDK" },
      { id: "sdk-google-adk", label: "Google ADK" },
      { id: "sdk-env", label: "Environment variables" },
    ],
  },
  {
    // Was 17 items, five of which said the same thing Core Concepts already
    // does (time-travel + step replay duplicated "Replay"; "Writing policies"
    // duplicated "Policies"; "CI release gate" duplicated "Evals & CI gate";
    // "Golden corpus" was a literal second section with that exact title).
    // That content is now folded into its Core Concepts section instead of
    // explained twice on two different scrolls of the same page. Pairwise
    // comparison and judge calibration were two entries for what the API
    // Reference group already treats as one ("Pairwise & calibration") —
    // merged here to match. Fleet benchmarks, team chargeback, and
    // compliance export existed as real sections in the page with NO nav
    // entry at all — unreachable except to someone who already knew the
    // anchor id — so they're folded into their closest sibling instead of
    // staying orphaned or adding three more top-level items.
    group: "Features",
    items: [
      { id: "feat-topology", label: "Fleet topology & benchmarks" },
      { id: "feat-policy-causes", label: "Policy causes" },
      { id: "feat-pii", label: "PII redaction" },
      { id: "feat-cost", label: "Cost attribution & chargeback" },
      { id: "feat-audit", label: "Signed audit records" },
      { id: "feat-regulatory", label: "Regulatory dashboard & compliance export" },
      { id: "feat-narratives", label: "Sealed AI narratives" },
      { id: "feat-eval-depth", label: "Pairwise comparison & judge calibration" },
      { id: "feat-corpus-miner", label: "Auto-mined adversarial tests" },
      { id: "feat-security-findings", label: "External security findings" },
      { id: "feat-external-grants", label: "External auditor grants" },
    ],
  },
  {
    group: "Self-hosting",
    items: [
      { id: "self-requirements", label: "Requirements" },
      { id: "self-docker", label: "Docker Compose" },
      { id: "self-env", label: "Environment variables" },
      { id: "self-upgrade", label: "Upgrading" },
    ],
  },
  {
    group: "API Reference",
    items: [
      { id: "api-auth", label: "Authentication" },
      { id: "api-runs", label: "Runs API" },
      { id: "api-prompts", label: "Prompts API" },
      { id: "api-approvals", label: "Approvals & Incidents" },
      { id: "api-eval-depth", label: "Pairwise & calibration" },
      { id: "api-audit", label: "Audit API" },
      { id: "api-narratives", label: "Narratives API" },
      { id: "api-security-findings", label: "Security findings API" },
      { id: "api-external-grants", label: "External grants API" },
      { id: "api-trust", label: "Trust chain API" },
      // Existed as a real page.tsx section with no nav entry at all — fixing
      // the same orphaned-section problem as the Features cuts above, not
      // adding scope.
      { id: "api-analytics", label: "Analytics & reporting API" },
      { id: "api-webhooks", label: "Webhooks" },
    ],
  },
  {
    group: "Plans & Limits",
    items: [
      { id: "plans-limits", label: "Rate limits & plan comparison" },
    ],
  },
];

export default function DocsNav({ selfHosted = false }: { selfHosted?: boolean }) {
  const [active, setActive] = useState("overview");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ids = NAV.flatMap((g) => g.items.map((i) => i.id));
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <nav className="docs-nav" aria-label="Documentation">
      <button
        className="docs-nav-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>Jump to section</span>
        <span className="docs-nav-toggle-icon">{open ? "▲" : "▼"}</span>
      </button>
      <div className={`docs-nav-inner${open ? " is-open" : ""}`}>
        {NAV.map((group) => (
          <div key={group.group} className="docs-nav-group">
            <div className="docs-nav-group-label">{group.group}</div>
            {group.items.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`docs-nav-item${active === item.id ? " active" : ""}`}
              >
                {item.label}
              </a>
            ))}
          </div>
        ))}
        <div className="docs-nav-group" style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1.2rem" }}>
          <Link href="/docs#sdk-langchain" className="docs-nav-item" scroll={false}>All integrations ↗</Link>
          {!selfHosted && <Link href="/get-started" className="docs-nav-item">Get started →</Link>}
          {!selfHosted && <Link href="/contact" className="docs-nav-item">Talk to us →</Link>}
        </div>
      </div>
    </nav>
  );
}
