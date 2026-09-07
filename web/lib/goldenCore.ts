/**
 * Golden-suite core — the PURE detection + dedup-signature logic (no DB), so it is
 * unit-testable in isolation. `golden.ts` adds the data layer around this.
 */
import { sha256, toolKeyFor } from "@runback/replay";

import type { TraceEvent, ToolEvent, RunEvent } from "@runback/schema";
import type { PolicyRule } from "./eval/policy";

export interface BadSignature {
  reason: "policy_block" | "error";
  signature: string;
  detail: string;
  /** The tool that threw, when the incident involves a specific tool call (error reason only). */
  tool_name?: string;
}

/**
 * Decide whether a finished run is a regression worth capturing, and produce its
 * dedup SIGNATURE — a hash of the failing decision, so identical failures across
 * many runs collapse to one golden test. Policy blocks take priority over errors.
 */
export function detectBad(runName: string, events: TraceEvent[]): BadSignature | null {
  const blocked = events.find((e): e is ToolEvent => e.type === "tool" && !!e.policy_block);
  if (blocked && blocked.policy_block) {
    const sig = sha256(`policy_block:${blocked.policy_block.rule}:${toolKeyFor(blocked.tool_name, blocked.input, blocked.key_projection)}`);
    return { reason: "policy_block", signature: sig, detail: `${blocked.tool_name} blocked — ${blocked.policy_block.rule}` };
  }
  const toolErr = events.find((e): e is ToolEvent => e.type === "tool" && !!e.error);
  const endErr = events.find((e): e is RunEvent => e.type === "run" && e.phase === "end" && e.status === "error");
  if (toolErr || endErr) {
    const key = toolErr ? toolKeyFor(toolErr.tool_name, toolErr.input, toolErr.key_projection) : "";
    const name = toolErr?.error?.name ?? endErr?.error?.name ?? "error";
    const sig = sha256(`error:${runName}:${name}:${key}`);
    const detail = toolErr ? `${runName} — ${toolErr.tool_name} threw ${toolErr.error?.name}` : `${runName} failed — ${name}`;
    return { reason: "error", signature: sig, detail, tool_name: toolErr?.tool_name };
  }
  return null;
}

export interface RuleSuggestion {
  /** Why this was suggested, and its honest limits — shown to the human who has to review it. */
  note: string;
  rule: PolicyRule;
}

/**
 * Draft a candidate policy rule from an uncovered incident — a starting point
 * for human review, never something applied automatically. This is the
 * direct answer to "the live blocking only catches what you've written a
 * rule for": it removes the blank-page step, not the human-judgment step.
 *
 * Deliberately returns null in two cases where there's nothing honest to
 * suggest:
 *   - policy_block reason: a rule already fired and caught this — there's no
 *     gap to fill, the checkbox is already ticked.
 *   - error reason with no specific tool (a run-level failure, not a tool
 *     call): the policy DSL has no predicate for "the run failed" independent
 *     of a tool call, so there is nothing to seed a rule from.
 *
 * For an error tied to a specific tool, the suggested predicate blocks EVERY
 * future call to that tool unconditionally — the DSL has no error-type
 * predicate, so there's no way to precisely express "only when it throws
 * this error." That's stated plainly in the note rather than papered over
 * with a guessed argument threshold that might be wrong in a way that looks
 * authoritative.
 */
export function suggestRule(bad: BadSignature): RuleSuggestion | null {
  if (bad.reason !== "error" || !bad.tool_name) return null;
  const tool = bad.tool_name;
  return {
    note:
      `Seeded from an uncovered incident — nothing was watching ${tool} when it failed. ` +
      `This predicate blocks EVERY call to ${tool}, unconditionally: the policy language has ` +
      `no way to say "only when it errors like this one did." Narrow it — e.g. wrap it in an ` +
      `"and" with a tool_arg condition specific to what actually went wrong — before activating it.`,
    rule: {
      id: `auto-${bad.signature.slice(0, 10)}`,
      description: `Auto-suggested, unreviewed — ${bad.detail}`,
      kind: "assert",
      pred: { op: "not", pred: { op: "tool_called", tool } },
    },
  };
}

const STREAK_GOOD = new Set(["reproduced", "changed"]);
const STREAK_BAD = new Set(["diverged", "recurs"]);

export interface GoldenRunHistoryRow {
  result: string;
  policy_digest: string | null;
}

/**
 * How many consecutive good results (newest first) an entry has, and how many
 * distinct policy snapshots that streak has survived. Pure: golden.ts feeds
 * this rows already sorted newest-first from ad_golden_runs (an append-only
 * table — see add_golden_history.sql), and it's what makes a streak a claim
 * about actually having run the suite continuously, not something a copy of
 * the current row could reproduce.
 */
export function computeStreak(historyNewestFirst: GoldenRunHistoryRow[]): { runs: number; policyRevisions: number } {
  let runs = 0;
  const digests = new Set<string>();
  for (const h of historyNewestFirst) {
    if (STREAK_BAD.has(h.result) || h.result === "missing") break;
    if (!STREAK_GOOD.has(h.result)) continue; // unrecognised result — skip without breaking the streak
    runs++;
    if (h.policy_digest) digests.add(h.policy_digest);
  }
  return { runs, policyRevisions: digests.size };
}

/** How long an approved golden entry can go without a fresh human look before
 *  it's flagged for re-review. Deliberately generous — this is a nudge, not
 *  an expiry; an entry that's still reproducing isn't wrong, just unlooked-at. */
export const STALE_REVIEW_DAYS = 180;

/**
 * Re-executing a golden entry (runGoldenSuite) proves its cassette still
 * reproduces the SAME recorded behavior — it says nothing about whether that
 * behavior is still the CORRECT one as policy or product requirements evolve.
 * Without this, an approved entry could go stale indefinitely with nothing
 * ever prompting a human to look at it again. Only "approved" entries
 * qualify: an "active" entry is already surfaced as needing its FIRST
 * review via its status, and a "dismissed" one is done, not stale.
 */
export function needsReReview(
  entry: { status: string; approved_at: string | null; created_at: string },
  now: Date = new Date()
): boolean {
  if (entry.status !== "approved") return false;
  const since = entry.approved_at ?? entry.created_at;
  return now.getTime() - new Date(since).getTime() > STALE_REVIEW_DAYS * 86400_000;
}
