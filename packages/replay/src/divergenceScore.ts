/**
 * Structured divergence scoring — the analytical layer model-diff was
 * missing. Counterfactual replay (runReplay.ts) already tells you a
 * decision changed; this tells you WHAT changed and how much, so "the
 * agent behaves differently on the new model" becomes "it now refunds
 * $250 instead of escalating" rather than a bare true/false.
 *
 * Deterministic on purpose — no judge-model call, no external dependency.
 * The captured decisions already carry real structure (tool_calls with
 * typed inputs, or text); this reads it instead of throwing it away into
 * a single "diverged" boolean. Same data, more of it used.
 *
 * Honest limit: the text-comparison path is character-level (Levenshtein
 * similarity), not semantic. It reliably catches near-duplicates
 * (whitespace, punctuation, a word or two) as "equivalent" — it does NOT
 * recognize a genuine paraphrase with several word substitutions as
 * equivalent, even when a human reading both would call them the same
 * answer. That needs an embedding or judge-model comparison, which this
 * module deliberately doesn't do, to stay deterministic and free to run on
 * every divergence rather than metered and probabilistic. Tool-call
 * comparison (name + argument structure) doesn't have this limitation —
 * it's an exact, structural comparison, not a similarity heuristic.
 *
 * Second honest limit: argument comparison pairs calls by tool_name, not by
 * position, so a step calling the same tool set in a different order is
 * compared correctly (this used to be positional and silently mispaired
 * reordered calls — see git history). The residual gap is TWO calls to the
 * SAME tool within one step swapping relative order — those are paired in
 * each side's own call order, so a genuine swap (not just an argument change)
 * between two same-named calls can still be missed.
 */
import type { ModelDecision } from "@runback/schema";

export type DivergenceCategory =
  | "tool_changed"   // a different tool was called, or one side called a tool and the other didn't
  | "args_changed"    // the same tool was called, with different arguments
  | "text_changed"    // no tool calls on either side, and the output text is materially different
  | "equivalent";      // technically different, but a paraphrase / non-semantic difference

export interface DivergenceScore {
  category: DivergenceCategory;
  /** 0-100. A severity heuristic, not a probability — combines what changed and by how much. */
  severity: number;
  reason: string;
}

/** Normalized Levenshtein similarity: 1 = identical, 0 = completely different. Bounded-cost for reasonably-sized model outputs. */
function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const MAX_LEN = 2000; // cap: this is a severity heuristic, not a diff tool — don't spend O(n*m) on huge outputs
  const s1 = a.length > MAX_LEN ? a.slice(0, MAX_LEN) : a;
  const s2 = b.length > MAX_LEN ? b.slice(0, MAX_LEN) : b;
  const m = s1.length, n = s2.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = s1[i - 1] === s2[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  const distance = prev[n];
  return 1 - distance / Math.max(m, n);
}

/** How much two tool-call argument objects differ. Numeric fields get a relative-delta magnitude (a $100→$250 change scores higher than a $100→$101 one); non-numeric field changes count as a fixed, meaningful-but-not-maximal delta. */
function argDelta(a: unknown, b: unknown): { changed: boolean; magnitude: number; description: string } {
  if (JSON.stringify(a) === JSON.stringify(b)) return { changed: false, magnitude: 0, description: "" };
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    let maxRel = 0;
    const parts: string[] = [];
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      const av = ao[k];
      const bv = bo[k];
      if (av === bv) continue;
      if (typeof av === "number" && typeof bv === "number") {
        const rel = av === 0 ? (bv === 0 ? 0 : 1) : Math.min(1, Math.abs(bv - av) / Math.abs(av));
        maxRel = Math.max(maxRel, rel);
        if (rel > 0) parts.push(`${k}: ${av} → ${bv}`);
      } else {
        maxRel = Math.max(maxRel, 0.7);
        parts.push(`${k} changed`);
      }
    }
    return { changed: parts.length > 0, magnitude: maxRel, description: parts.join(", ") };
  }
  return { changed: true, magnitude: 0.7, description: "argument changed" };
}

/**
 * Score how much two decisions on the SAME captured step actually differ.
 * `recorded` is what the run's original model decided; `counterfactual` is
 * what the candidate model decided when replayed against the exact same
 * captured context.
 */
export function scoreDivergence(recorded: ModelDecision, counterfactual: ModelDecision): DivergenceScore {
  const aTools = [...recorded.tool_calls].map((t) => t.tool_name).sort();
  const bTools = [...counterfactual.tool_calls].map((t) => t.tool_name).sort();

  // One side acted (called a tool), the other just answered — the biggest
  // practical behavior change a model swap can produce.
  if ((aTools.length > 0) !== (bTools.length > 0)) {
    return {
      category: "tool_changed",
      severity: 95,
      reason: aTools.length
        ? `now answers directly instead of calling ${aTools.join(", ")}`
        : `now calls ${bTools.join(", ")} instead of just answering`,
    };
  }

  // Both act, but on different tools entirely.
  if (JSON.stringify(aTools) !== JSON.stringify(bTools)) {
    return {
      category: "tool_changed",
      severity: 90,
      reason: `calls ${bTools.join(", ") || "nothing"} instead of ${aTools.join(", ") || "nothing"}`,
    };
  }

  // Same tool(s) called — the divergence is in the arguments. Pair calls by
  // tool_name, not array index: a step can call the same set of tools in a
  // different order (multi-tool-call steps commonly aren't 1:1 positional),
  // and index-pairing silently skipped every mismatched-position pair —
  // reporting a reordered call with drastically different arguments as
  // "equivalent" because a[i].tool_name !== b[i].tool_name never got compared
  // at all. Grouping by name and pairing within each name's own call order
  // fixes the common reorder case; two calls to the SAME tool swapping order
  // relative to each other is a narrower residual gap (see comparePair test).
  if (aTools.length > 0) {
    const groupByName = (calls: ModelDecision["tool_calls"]) => {
      const m = new Map<string, ModelDecision["tool_calls"]>();
      for (const c of calls) {
        const arr = m.get(c.tool_name);
        if (arr) arr.push(c); else m.set(c.tool_name, [c]);
      }
      return m;
    };
    const aGroups = groupByName(recorded.tool_calls);
    const bGroups = groupByName(counterfactual.tool_calls);
    let maxMagnitude = 0;
    const reasons: string[] = [];
    for (const [name, aCalls] of aGroups) {
      const bCalls = bGroups.get(name) ?? [];
      const n = Math.min(aCalls.length, bCalls.length);
      for (let i = 0; i < n; i++) {
        const d = argDelta(aCalls[i].input, bCalls[i].input);
        if (d.changed) {
          maxMagnitude = Math.max(maxMagnitude, d.magnitude);
          reasons.push(`${name}(${d.description})`);
        }
      }
    }
    if (maxMagnitude === 0) {
      return { category: "equivalent", severity: 5, reason: "same tool, same arguments — likely a non-semantic difference (ordering, formatting)" };
    }
    // 30-85 range: even a small numeric nudge is a real behavior change on a
    // tool call (unlike a text paraphrase), so the floor is meaningfully
    // above "equivalent" even at low magnitude.
    return { category: "args_changed", severity: Math.round(Math.min(85, 30 + maxMagnitude * 55)), reason: reasons.join("; ") };
  }

  // Neither side calls a tool — compare the text response itself.
  const sim = textSimilarity(recorded.text ?? "", counterfactual.text ?? "");
  if (sim > 0.85) {
    return { category: "equivalent", severity: Math.round((1 - sim) * 40), reason: "worded differently but highly similar in substance" };
  }
  return { category: "text_changed", severity: Math.round(20 + (1 - sim) * 60), reason: "materially different response text" };
}
