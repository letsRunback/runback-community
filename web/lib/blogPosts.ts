import type { ComponentType } from "react";
import DeterministicDataRace from "@/app/blog/posts/deterministic-data-race";
import TimeTravelReplayWalkthrough from "@/app/blog/posts/time-travel-replay-walkthrough";
import HashChainedAuditTrail from "@/app/blog/posts/hash-chained-audit-trail";
import RedactBeforeItLeaves from "@/app/blog/posts/redact-before-it-leaves";
import ReplayFromStepN from "@/app/blog/posts/replay-from-step-n";
import ThreeWaysToWireInRunback from "@/app/blog/posts/three-ways-to-wire-in-runback";
import SimulateAPolicyBeforeEnforcingIt from "@/app/blog/posts/simulate-a-policy-before-enforcing-it";
import MiningIncidentsIntoRegressionTests from "@/app/blog/posts/mining-incidents-into-regression-tests";
import BisectAModelRegression from "@/app/blog/posts/bisect-a-model-regression";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO date
  author: string;
  tags: string[];
  Body: ComponentType;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "simulate-a-policy-before-enforcing-it",
    title: "Simulate a policy against history before you enforce it live",
    description:
      "How Runback's policy simulator checks a candidate rule against 100 recorded runs — no model calls, no replay — and names the exact runs it would have blocked.",
    date: "2026-02-18",
    author: "Runback Team",
    tags: ["product", "policy"],
    Body: SimulateAPolicyBeforeEnforcingIt,
  },
  {
    slug: "mining-incidents-into-regression-tests",
    title: "How we auto-mine production incidents into regression tests",
    description:
      "A failed run becomes a permanent golden-suite entry, deduped by signature so a thousand identical incidents collapse into one test that keeps checking itself.",
    date: "2026-04-02",
    author: "Runback Team",
    tags: ["engineering", "product"],
    Body: MiningIncidentsIntoRegressionTests,
  },
  {
    slug: "bisect-a-model-regression",
    title: "Bisecting a model regression in 4 probes instead of 12",
    description:
      "git bisect for agent behaviour: binary-searching a candidate timeline for the exact model or prompt change that introduced a regression, in O(log n) re-executions.",
    date: "2026-05-27",
    author: "Runback Team",
    tags: ["engineering", "determinism"],
    Body: BisectAModelRegression,
  },
  {
    slug: "deterministic-data-race",
    title: "We deterministically reproduced a real data race",
    description:
      "A stress test of Runback's replay engine: reproducing a genuine, lock-free data race byte-for-byte, three runs in a row, proven in CI on every push.",
    date: "2026-07-14",
    author: "Runback Team",
    tags: ["engineering", "determinism"],
    Body: DeterministicDataRace,
  },
  {
    slug: "time-travel-replay-walkthrough",
    title: "Debugging an AI agent with time-travel replay",
    description:
      "A walkthrough of a real failing agent — from error-first navigation to editing the exact captured request and replaying it.",
    date: "2026-07-14",
    author: "Runback Team",
    tags: ["product", "debugging"],
    Body: TimeTravelReplayWalkthrough,
  },
  {
    slug: "hash-chained-audit-trail",
    title: "What a hash-chained audit trail actually proves",
    description:
      "The exact algorithm behind Runback's signed, append-only audit record — and what it means for EU AI Act and APRA CPS 230 compliance.",
    date: "2026-07-14",
    author: "Runback Team",
    tags: ["compliance", "engineering"],
    Body: HashChainedAuditTrail,
  },
  {
    slug: "redact-before-it-leaves",
    title: "Redacting secrets before they ever leave your process",
    description:
      "How @runback/redact scrubs API keys, JWTs, SSNs, and card numbers in-process, before anything is sent anywhere.",
    date: "2026-07-14",
    author: "Runback Team",
    tags: ["security", "engineering"],
    Body: RedactBeforeItLeaves,
  },
  {
    slug: "replay-from-step-n",
    title: "Why replay-from-step-N is harder than it looks",
    description:
      "Why capturing the request at the wrapLanguageModel boundary — not at your own call sites — is what makes replay mean something.",
    date: "2026-07-14",
    author: "Runback Team",
    tags: ["engineering", "architecture"],
    Body: ReplayFromStepN,
  },
  {
    slug: "three-ways-to-wire-in-runback",
    title: "Three ways to wire an agent into Runback",
    description:
      "How to pick between the Vercel AI SDK integration, an OpenTelemetry exporter, and the framework-agnostic manual recorder — with the actual commands for each.",
    date: "2026-07-14",
    author: "Runback Team",
    tags: ["integrations", "getting-started"],
    Body: ThreeWaysToWireInRunback,
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

export function allBlogPostsSortedByDate(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
}
