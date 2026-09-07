/**
 * llm_judge — the one scorer that needs a model call, so it runs async in the
 * eval runner rather than in the synchronous `runScorer` switch.
 *
 * Two depths, one code path:
 *   • a single natural-language RUBRIC → one 0..1 score (the simple case), or
 *   • a structured set of weighted CRITERIA → a per-criterion 0..1 vector,
 *     aggregated as a weighted mean (a real rubric grader, not a vibe check).
 * Either can be sampled N times for SELF-CONSISTENCY (median over samples) to damp
 * the judge's own variance. The grading/aggregation logic is pure and exported so
 * it is tested without a live model; only the generation is wrapped.
 */
import { generateText } from "ai";
import crypto from "crypto";
import { resolveModel } from "@/lib/replay/runStep";
import type { Provider } from "@/lib/modelKeys";
import type { ScoreResult, JudgeCriterion } from "./scorers";

// A small, reliable, cheap model per provider — the right default for grading.
const JUDGE_MODEL_ENV = process.env.JUDGE_MODEL;
const JUDGE_MODEL_DEFAULTS: Record<Provider, string> = {
  groq: "openai/gpt-oss-120b",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
};
const PROVIDER_KEY_ENV: Record<Provider, string> = {
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/**
 * An explicit JUDGE_MODEL env always wins. Otherwise, pick a small default
 * model from whichever provider actually has a key configured — org BYOK
 * first, then the deployment's env var — so a self-hosted org with only
 * OPENAI_API_KEY (no Groq access) still gets a working judge instead of
 * failing on a Groq-specific default no key of theirs can satisfy.
 */
export function pickJudgeModel(keys?: Partial<Record<Provider, string>>): string {
  if (JUDGE_MODEL_ENV) return JUDGE_MODEL_ENV;
  for (const p of ["groq", "openai", "anthropic"] as Provider[]) {
    if (keys?.[p] || process.env[PROVIDER_KEY_ENV[p]]) return JUDGE_MODEL_DEFAULTS[p];
  }
  // No key anywhere — fall through to the groq default; resolveModel() below
  // throws its own friendly "add one in Settings → Model keys" error.
  return JUDGE_MODEL_DEFAULTS.groq;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const fail = (detail: string): ScoreResult => ({ scorer: "llm_judge", passed: false, score: 0, detail });

/* ── Pure grading/aggregation (exported for tests) ─────────────────────────── */

/** Median of a list (mean of the two middle values for even counts). 0 if empty. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Weighted mean of per-criterion scores. Falls back to a plain mean if all weights are 0. */
export function weightedMean(scores: Record<string, number>, criteria: JudgeCriterion[]): number {
  let num = 0, den = 0;
  for (const c of criteria) {
    const w = c.weight ?? 1;
    const v = clamp01(scores[c.name] ?? 0);
    num += v * w;
    den += w;
  }
  if (den === 0) {
    const vals = criteria.map((c) => clamp01(scores[c.name] ?? 0));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  return num / den;
}

export interface JudgeReply {
  /** Single-rubric score, when no criteria were requested. */
  score?: number;
  /** Per-criterion scores, when criteria were requested. */
  scores?: Record<string, number>;
  reason: string;
}

/**
 * Parse a judge reply, tolerating prose/code-fences around the JSON. When
 * `criteriaNames` is given, pull a per-name score vector; otherwise a single score.
 */
export function parseJudgeReply(text: string, criteriaNames?: string[]): JudgeReply {
  const match = text.match(/\{[\s\S]*\}/);
  let obj: Record<string, unknown> | null = null;
  if (match) { try { obj = JSON.parse(match[0]) as Record<string, unknown>; } catch { obj = null; } }

  const reason = obj && typeof obj.reason === "string" ? obj.reason : text.trim().slice(0, 140);

  if (criteriaNames && criteriaNames.length) {
    const scores: Record<string, number> = {};
    const bag = (obj?.scores ?? obj) as Record<string, unknown> | undefined;
    for (const name of criteriaNames) {
      const raw = bag?.[name];
      const n = typeof raw === "number" ? raw : Number(raw);
      scores[name] = Number.isFinite(n) ? clamp01(n) : 0;
    }
    return { scores, reason };
  }

  if (obj && obj.score != null) {
    const n = typeof obj.score === "number" ? obj.score : Number(obj.score);
    if (Number.isFinite(n)) return { score: clamp01(n), reason };
  }
  // Loose fallback: first 0..1 number in the text.
  const num = text.match(/(?:score\D*)?(0?\.\d+|0|1(?:\.0+)?)/i);
  return { score: num ? clamp01(Number(num[1])) : 0, reason };
}

/**
 * Aggregate N judge samples into one ScoreResult. Per-criterion: median across
 * samples, then weighted mean. Single-rubric: median across samples.
 */
export function aggregateJudge(
  replies: JudgeReply[],
  opts: { threshold: number; criteria?: JudgeCriterion[] }
): ScoreResult {
  const { threshold, criteria } = opts;
  if (criteria && criteria.length) {
    const perCriterion: Record<string, number> = {};
    for (const c of criteria) {
      perCriterion[c.name] = median(replies.map((r) => r.scores?.[c.name] ?? 0));
    }
    const score = clamp01(weightedMean(perCriterion, criteria));
    const breakdown = criteria.map((c) => `${c.name} ${perCriterion[c.name].toFixed(2)}`).join(", ");
    const reason = replies.find((r) => r.reason)?.reason ?? "";
    return {
      scorer: "llm_judge",
      passed: score >= threshold,
      score: Number(score.toFixed(4)),
      detail: `${score.toFixed(2)} vs ${threshold} [${breakdown}]${reason ? ` — ${reason}` : ""}`,
    };
  }
  const score = clamp01(median(replies.map((r) => r.score ?? 0)));
  const reason = replies.find((r) => r.reason)?.reason ?? "";
  return {
    scorer: "llm_judge",
    passed: score >= threshold,
    score: Number(score.toFixed(4)),
    detail: `${score.toFixed(2)} vs ${threshold} threshold${reason ? ` — ${reason}` : ""}`,
  };
}

/* ── Prompt + model call ───────────────────────────────────────────────────── */

/** A judge correction fed back into the prompt as a few-shot example — see
 *  lib/eval/calibration.ts, which sources these from human-reviewed disagreements. */
export interface JudgeFewShotExample {
  output: string;
  passed: boolean;
  reason: string;
}

function fewShotBlock(examples?: JudgeFewShotExample[]): string {
  if (!examples || !examples.length) return "";
  const lines = examples.map((e, i) =>
    `Example ${i + 1} — a human reviewer said this output should be graded ${e.passed ? "PASS" : "FAIL"}${e.reason ? ` ("${e.reason}")` : ""}:\n"""\n${e.output}\n"""`
  ).join("\n\n");
  return `\nCORRECTIONS FROM PAST HUMAN REVIEW — weigh these when grading similar outputs:\n${lines}\n`;
}

function buildPrompt(output: string | null, rubric: string, criteria?: JudgeCriterion[], fewShot?: JudgeFewShotExample[]): string {
  const grade = output ?? "(the model produced no text output)";
  const corrections = fewShotBlock(fewShot);
  if (criteria && criteria.length) {
    const lines = criteria
      .map((c) => `- "${c.name}"${c.description ? `: ${c.description}` : ""}`)
      .join("\n");
    const shape = `{"scores": {${criteria.map((c) => `"${c.name}": <0..1>`).join(", ")}}, "reason": "<one short sentence>"}`;
    return `You are strictly grading an AI model's output against EACH criterion below, independently.
Respond with ONLY a JSON object: ${shape}
1.0 = fully satisfies that criterion, 0.0 = fails it completely.

CRITERIA:
${lines}
${corrections}
OUTPUT TO GRADE:
"""
${grade}
"""`;
  }
  return `You are grading an AI model's output against a rubric. Be strict and objective.
Respond with ONLY a JSON object: {"score": <number 0..1>, "reason": "<one short sentence>"}.
1.0 = fully satisfies the rubric, 0.0 = fails it completely.

RUBRIC:
${rubric}
${corrections}
OUTPUT TO GRADE:
"""
${grade}
"""`;
}

/** Stable signature for a judge config, so calibration data (lib/eval/calibration.ts)
 *  generalizes across every dataset/eval that grades with the same rubric. */
export function rubricHash(rubric: string, criteria?: JudgeCriterion[]): string {
  const sig = JSON.stringify({ rubric, criteria: criteria ?? null });
  return crypto.createHash("sha256").update(sig).digest("hex");
}

export async function runLlmJudge(opts: {
  output: string | null;
  rubric: string;
  threshold?: number;
  criteria?: JudgeCriterion[];
  /** Self-consistency: grade this many times and take the median. Default 1. */
  samples?: number;
  /** Org's BYOK provider keys (from lib/modelKeys.ts's getOrgKeys) — falls back to
   *  the deployment's env vars via resolveModel, exactly like every other model call. */
  keys?: Partial<Record<Provider, string>>;
  /** Past human corrections for this rubric, injected as few-shot examples. */
  fewShot?: JudgeFewShotExample[];
}): Promise<ScoreResult> {
  const threshold = opts.threshold ?? 0.5;
  const criteria = opts.criteria;
  const samples = Math.max(1, Math.min(7, opts.samples ?? 1));
  const prompt = buildPrompt(opts.output, opts.rubric, criteria, opts.fewShot);
  const names = criteria?.map((c) => c.name);

  let model;
  let judgeModelId: string;
  try {
    judgeModelId = pickJudgeModel(opts.keys);
    model = resolveModel(judgeModelId, "groq", opts.keys);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  try {
    // Self-consistency samples are independent — run them concurrently.
    const replies = await Promise.all(
      Array.from({ length: samples }, async () => {
        const { text } = await generateText({ model, prompt, temperature: samples > 1 ? 0.4 : 0 });
        return parseJudgeReply(text, names);
      })
    );
    // judgeModel travels with the result so calibration.ts can key stored
    // corrections by which model actually produced them — see recordJudgeReview.
    return { ...aggregateJudge(replies, { threshold, criteria }), judgeModel: judgeModelId };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/* ── Pairwise comparison — which of two outputs is better for the same input ── */

export type PairwiseSide = "a" | "b" | "tie";
export interface PairwiseVerdict { winner: PairwiseSide; reason: string }

function buildPairwisePrompt(input: string, outputA: string | null, outputB: string | null): string {
  return `You are comparing two AI outputs for the SAME input and deciding which is better —
more correct, more helpful, more complete. If they are truly equivalent, say tie.
Respond with ONLY a JSON object: {"winner": "a" | "b" | "tie", "reason": "<one short sentence>"}.

INPUT:
"""
${input}
"""

OUTPUT A:
"""
${outputA ?? "(no text output)"}
"""

OUTPUT B:
"""
${outputB ?? "(no text output)"}
"""`;
}

/** Tolerates prose/code-fences around the JSON, same discipline as parseJudgeReply. */
export function parsePairwiseReply(text: string): PairwiseVerdict {
  const match = text.match(/\{[\s\S]*\}/);
  let obj: Record<string, unknown> | null = null;
  if (match) { try { obj = JSON.parse(match[0]) as Record<string, unknown>; } catch { obj = null; } }
  const reason = obj && typeof obj.reason === "string" ? obj.reason : text.trim().slice(0, 140);
  const raw = typeof obj?.winner === "string" ? obj.winner.toLowerCase().trim() : "";
  const winner: PairwiseSide = raw === "a" || raw === "b" ? raw : "tie";
  return { winner, reason };
}

/**
 * Judge which of two outputs is better for the same input. Randomizes which
 * side is shown to the model as "A" (LLM judges are known to favor whichever
 * answer comes first) and un-swaps the verdict before returning, so the
 * caller-supplied a/b always means what it says regardless of what the model
 * actually saw.
 */
/**
 * `ok: false` means the judge never actually ran (no model key, provider
 * error) — the caller must NOT record this as a real "tie" verdict. A tie is
 * a judgment; a missing key is an outage, and conflating the two used to
 * silently poison summarizePairwise's stats with fake ties that could never
 * be retried once the row existed.
 */
export async function runPairwiseJudge(opts: {
  input: string;
  outputA: string | null;
  outputB: string | null;
  keys?: Partial<Record<Provider, string>>;
  randomizeOrder?: boolean;
}): Promise<(PairwiseVerdict & { randomized: boolean; judgeModel: string; ok: true }) | { ok: false; reason: string }> {
  const randomize = opts.randomizeOrder ?? true;
  const swapped = randomize && Math.random() < 0.5;
  const [shownA, shownB] = swapped ? [opts.outputB, opts.outputA] : [opts.outputA, opts.outputB];

  let model;
  let judgeModelId: string;
  try {
    judgeModelId = pickJudgeModel(opts.keys);
    model = resolveModel(judgeModelId, "groq", opts.keys);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  try {
    const { text } = await generateText({ model, prompt: buildPairwisePrompt(opts.input, shownA, shownB), temperature: 0 });
    const reply = parsePairwiseReply(text);
    // Un-swap: what the model called "a" was really "b" if we swapped going in.
    const winner: PairwiseSide = !swapped ? reply.winner : reply.winner === "a" ? "b" : reply.winner === "b" ? "a" : "tie";
    return { ok: true, winner, reason: reply.reason, randomized: swapped, judgeModel: judgeModelId };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
