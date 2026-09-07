"use client";
import { routeAvailable } from "@/lib/edition";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Answers "how do these pages connect?" — the confusion a new user hits
 * landing on, say, /app/prompts or /app/evals with no sense of which comes
 * first or why. One line, at the top of every page in the four-stage story:
 * the current stage's real page sequence, in the order you'd actually use
 * them, with the page you're on called out instead of linked.
 *
 * Deliberately terse (no per-page essay) — the sequence itself is the
 * explanation. Workspace pages (Team/Cost/Settings) are plain SaaS utility,
 * not part of the story, so they're intentionally excluded.
 */
type Item = { href: string; label: string };
type Stage = { n: string; tone: string; title: string; items: Item[] };

const STAGES: Stage[] = [
  {
    n: "01", tone: "blue", title: "Observe",
    items: [
      { href: "/app", label: "Overview" },
      { href: "/app/runs", label: "Runs" },
      { href: "/app/alerts", label: "Alerts" },
      { href: "/app/incidents", label: "Incidents" },
    ],
  },
  {
    n: "02", tone: "violet", title: "Replay",
    items: [
      { href: "/app/prompts", label: "Prompts" },
      { href: "/app/datasets", label: "Datasets" },
      { href: "/app/evals", label: "Evals" },
      { href: "/app/golden", label: "Golden" },
      { href: "/app/evals/compare", label: "Compare" },
      { href: "/app/evals/calibrate", label: "Calibrate" },
      { href: "/app/benchmark", label: "Benchmark" },
      { href: "/app/corpus", label: "Corpus" },
    ],
  },
  {
    n: "03", tone: "amber", title: "Gate",
    items: [
      { href: "/app/policies", label: "Policies" },
      { href: "/app/policies/library", label: "Library" },
      { href: "/app/policies/causes", label: "Causes" },
      { href: "/app/models", label: "Models" },
      { href: "/app/models/diff", label: "Diff" },
      { href: "/app/models/gate", label: "Gate" },
      { href: "/app/models/drift", label: "Drift" },
      { href: "/app/models/bisect", label: "Bisect" },
      { href: "/app/approvals", label: "Approvals" },
    ],
  },
  {
    n: "04", tone: "emerald", title: "Audit",
    items: [
      { href: "/app/coverage", label: "Coverage" },
      { href: "/app/compliance", label: "Compliance" },
      { href: "/app/ledger", label: "Ledger" },
      { href: "/app/regulatory", label: "Regulatory" },
      { href: "/app/activity", label: "Activity" },
    ],
  },
];

// One line per page, said once here rather than duplicated as a subhead on
// every page — what it's actually for, in relation to its neighbours.
const WHY: Record<string, string> = {
  "/app/prompts": "Version your prompts here — then test a version against real cases in Evals before you promote it.",
  "/app/datasets": "The test cases Evals runs against — pulled from real captured runs, or written by hand.",
  "/app/evals": "Run a prompt/model from Prompts against a Dataset and score it — this is the release gate.",
  "/app/golden": "Production incidents auto-mined into a permanent Dataset, so a fixed bug never silently comes back.",
  "/app/evals/compare": "Two finished Evals, judged head-to-head — which one actually wrote the better answer.",
  "/app/evals/calibrate": "Correct the judge used in Compare and Evals — corrections make it more accurate next time.",
  "/app/benchmark": "Your fleet vs. anonymised peers — sourced from the same Corpus signals below.",
  "/app/corpus": "Fleet-wide anomaly patterns that feed the Benchmark score above.",
  "/app/policies": "Write a rule, Simulate it against history in the same page, then enforce it live.",
  "/app/policies/library": "Start from a template instead of a blank policy — import into Policies.",
  "/app/policies/causes": "Which Policies block the most, and for which agents — for tuning rules that are too strict.",
  "/app/models": "Every model your fleet has called — jump to Diff or Gate to compare or vet one.",
  "/app/models/diff": "Semantic diff between two model versions — what changed in behavior, not just the score.",
  "/app/models/gate": "Run Golden against a candidate model before switching — block the upgrade if it regresses.",
  "/app/models/drift": "Catch a model quietly changing upstream, with no code change on your side.",
  "/app/models/bisect": "Binary-search a candidate list for the exact one that broke it — O(log n) probes, each one recorded.",
  "/app/approvals": "Your agent code calls the API to route a specific decision to a human, instead of it running unchecked.",
  "/app/coverage": "Which agents are actually instrumented — what Runback can't see yet.",
  "/app/compliance": "An audit-ready evidence report, built from the Ledger below.",
  "/app/ledger": "The tamper-evident seal over every run — feeds the Compliance report above.",
  "/app/regulatory": "Your live run data mapped to named framework controls (EU AI Act, ISO 42001, NIST AI RMF).",
  "/app/activity": "Who did what, when — account and admin actions, not agent runs.",
};

export default function StageMap() {
  const pathname = usePathname();
  const stage = STAGES.find((s) => s.items.some((i) => i.href === pathname));
  if (!stage) return null; // Overview, Workspace pages, dynamic detail routes — not part of the story map

  const why = WHY[pathname];

  return (
    <div className="stagemap">
      <div className="stagemap-row">
        <span className="stagemap-badge mono" data-tone={stage.tone}>{stage.n} · {stage.title}</span>
        <span className="stagemap-divider" aria-hidden />
        {stage.items.filter((item) => routeAvailable(item.href)).map((item, i) => (
          <span key={item.href} style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
            {i > 0 && <span className="stagemap-chevron" aria-hidden>›</span>}
            {item.href === pathname
              ? <span className="stagemap-pill" data-current>{item.label}</span>
              : <Link href={item.href} className="stagemap-pill">{item.label}</Link>}
          </span>
        ))}
      </div>
      {why && <p className="stagemap-why">{why}</p>}
    </div>
  );
}
