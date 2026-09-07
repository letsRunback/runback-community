/**
 * Self-verifying changelog — the same hash-chain construction as the audit
 * ledger (web/lib/ledgerCore.ts) and the public transparency log
 * (web/lib/transparency.ts), applied to our own release history instead of
 * customer runs. If a tamper-evident chain is worth building for customers,
 * it's worth running on ourselves where anyone can already check it.
 *
 * Deliberately a static, checked-in array, not a database table: there is no
 * live "seal a release" workflow yet, and building one before there's a real
 * multi-person release process to seal would be process for its own sake.
 * Entries here are curated, customer-facing release notes — not a raw git
 * log dump, which would surface internal engineering detail (bug names,
 * QA-pass admissions) that belongs in commit history, not a trust page.
 *
 * To add a release: append one entry to RELEASES below (never edit an
 * existing one — that's exactly what the chain is built to catch) and run
 * `npx vitest run web/lib/__tests__/changelog.test.ts` to confirm the new
 * chain still verifies before committing.
 */
import { sha256, canonical } from "@runback/replay";

export interface ChangelogRelease {
  version: string; // calendar-versioned (YYYY.MM.DD[.N]) — no semver process exists to claim otherwise
  date: string; // YYYY-MM-DD
  summary: string;
  highlights: string[];
}

export interface ChangelogEntry extends ChangelogRelease {
  seq: number;
  prev_hash: string;
  entry_hash: string;
}

// Ordered oldest → newest. Each is a real, shipped, deployed change — dated
// from the commit(s) that shipped it.
const RELEASES: ChangelogRelease[] = [
  {
    version: "2026.08.31",
    date: "2026-08-31",
    summary: "Completed the tenant-isolation (RLS) migration and added session revocation.",
    highlights: [
      "Every remaining read path now runs on the tenant-scoped client — Postgres row-level security is load-bearing, not decorative, on every query.",
      "Sessions can now be explicitly revoked (not just expired), with the revocation itself recorded in the admin audit trail.",
    ],
  },
  {
    version: "2026.08.31.1",
    date: "2026-08-31",
    summary: "Shipped Go SDK Phase 1: event capture, redaction, and cassette hash-chaining.",
    highlights: [
      "A first-party Go SDK now captures model/tool calls and posts them to ingest, alongside the existing TypeScript and Python SDKs.",
      "Redaction and cassette hash-chaining were ported from the TypeScript implementation and are on by default, not opt-in.",
    ],
  },
  {
    version: "2026.08.31.2",
    date: "2026-08-31",
    summary: "Published a measured onboarding number instead of an unmeasured claim.",
    highlights: [
      "\"Time to first captured run\" is now a real, scripted benchmark timing a fresh workspace through its first ingested event — published on the onboarding and pricing pages.",
    ],
  },
  {
    version: "2026.09.01",
    date: "2026-09-01",
    summary: "Live hover tooltips on every dashboard chart; removed remaining static/placeholder data.",
    highlights: [
      "Every chart in the app now shows a real data tooltip on hover, sourced from the same query the chart itself renders from — nothing hard-coded.",
    ],
  },
  {
    version: "2026.09.01.1",
    date: "2026-09-01",
    summary: "Added a live public verification badge for the audit ledger.",
    highlights: [
      "Any workspace with a sealed ledger can embed a badge that renders fresh, server-side, from the same public transparency log this changelog borrows its design from — not a static image.",
    ],
  },
  {
    version: "2026.09.01.2",
    date: "2026-09-01",
    summary: "Published clause-by-clause regulatory maps for six more frameworks.",
    highlights: [
      "ISO/IEC 42001, NIST AI RMF, APRA CPS 230, APRA CPS 234, GDPR, and ISO/IEC 27001 each now have a public page mapping clauses to the exact Runback capability and evidence type behind them — generated from the same static definitions the in-app Regulatory tab evaluates live.",
    ],
  },
];

function computeChain(releases: ChangelogRelease[]): ChangelogEntry[] {
  let prev = "";
  return releases.map((r, i) => {
    const entry_hash = sha256(prev + canonical(r));
    const entry: ChangelogEntry = { ...r, seq: i + 1, prev_hash: prev, entry_hash };
    prev = entry_hash;
    return entry;
  });
}

// Computed once at module load — a static array, so this never varies at runtime.
const ENTRIES: ChangelogEntry[] = computeChain(RELEASES);

/** Newest first, for display. */
export function changelogEntries(): ChangelogEntry[] {
  return [...ENTRIES].reverse();
}

/** Re-derive the chain and compare — the same check anyone reading this file can run themselves. */
export function verifyChangelogChain(entries: ChangelogEntry[]): { ok: boolean; brokenAt: number | null } {
  const oldestFirst = [...entries].sort((a, b) => a.seq - b.seq);
  let prev = "";
  for (const e of oldestFirst) {
    const { seq, prev_hash, entry_hash, ...release } = e;
    void seq;
    if (prev_hash !== prev) return { ok: false, brokenAt: e.seq };
    const expect = sha256(prev + canonical(release));
    if (expect !== entry_hash) return { ok: false, brokenAt: e.seq };
    prev = entry_hash;
  }
  return { ok: true, brokenAt: null };
}
