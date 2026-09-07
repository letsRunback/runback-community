/**
 * AI root-cause / compliance narratives — the generation half of the
 * "verifiable AI narration" pair (see web/lib/narratives.ts for the sealing
 * half). Conventions mirror judge.ts exactly: same provider-fallback model
 * picking, same generateText call shape, same tolerant-not-retry parsing
 * discipline (malformed output degrades gracefully, never throws into the
 * caller — an unsealed narrative attempt should fail loudly at the route
 * level, not from a swallowed exception here).
 *
 * Scope, deliberately: v1 explains model-diff divergences, not raw bisect
 * probes. web/lib/modelDiff.ts's counterfactual path already computes real,
 * structured divergence data via @runback/replay's scoreDivergence
 * (category, severity, reason) from actual captured decision content — a
 * genuinely grounded narrative can be built from it. A raw bisect
 * (packages/replay/src/enterprise/bisect.ts) only narrows to a candidate BOUNDARY
 * (firstBadIndex/probes) with no decision-content comparison at that
 * boundary surfaced anywhere today — narrating it would mean inventing
 * detail the system doesn't actually have. Extending to bisect is a
 * deliberate v2, once that data is genuinely available, not a gap papered
 * over here.
 */
import { generateText } from "ai";
import { resolveModel } from "@/lib/replay/runStep";
import { demoHash } from "./demoHash";
import type { Provider } from "@/lib/modelKeys";
import type { DivergenceCategory } from "@runback/replay";

const NARRATIVE_MODEL_ENV = process.env.NARRATIVE_MODEL;
const NARRATIVE_MODEL_DEFAULTS: Record<Provider, string> = {
  groq: "openai/gpt-oss-120b",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
};
const PROVIDER_KEY_ENV: Record<Provider, string> = {
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** Same provider-selection convention as judge.ts's pickJudgeModel — an
 *  explicit env override wins, else the first provider with a configured key. */
export function pickNarrativeModel(keys?: Partial<Record<Provider, string>>): string {
  if (NARRATIVE_MODEL_ENV) return NARRATIVE_MODEL_ENV;
  for (const p of ["groq", "openai", "anthropic"] as Provider[]) {
    if (keys?.[p] || process.env[PROVIDER_KEY_ENV[p]]) return NARRATIVE_MODEL_DEFAULTS[p];
  }
  return NARRATIVE_MODEL_DEFAULTS.groq;
}

export interface ModelDiffNarrativeContext {
  agentName: string;
  modelA: string;
  modelB: string;
  divergenceCategory: DivergenceCategory;
  divergenceSeverity: number; // 0-100
  divergenceReason: string;
  verdict: string;
  runId: string;
}

export interface RootCauseNarrativeResult {
  text: string;
  modelId: string;
}

function buildRootCauseNarrativePrompt(ctx: ModelDiffNarrativeContext): string {
  return `You are explaining, in plain English, why an AI agent behaved differently after a model upgrade — for a reader who may not be an engineer (a compliance reviewer, an on-call engineer triaging an incident, or an auditor).

FACTS (do not invent anything beyond these — if a detail isn't here, don't claim it):
- Agent: ${ctx.agentName}
- Compared models: ${ctx.modelA} → ${ctx.modelB}
- What changed (structural classification): ${ctx.divergenceCategory}
- Severity (0-100, higher = more consequential): ${ctx.divergenceSeverity}
- Mechanical reason (from deterministic comparison, not a guess): ${ctx.divergenceReason}
- Verdict: ${ctx.verdict}
- Run under comparison: ${ctx.runId}

Write 2-4 sentences: (1) what specifically changed, in plain language, (2) why that matters for whoever relies on this agent, (3) what "${ctx.divergenceCategory}" concretely means here — do not just repeat the label. Do not speculate about internal model reasoning you have no evidence of. Do not add a recommendation or next step — that's a separate feature. Respond with ONLY a JSON object: {"narrative": "<your 2-4 sentences>"}`;
}

/** Tolerant parse — same discipline as judge.ts's parseJudgeReply: regex-extract the JSON object, fall back to the raw text (trimmed) rather than throwing on malformed output. */
export function parseNarrativeReply(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as Record<string, unknown>;
      if (typeof obj.narrative === "string" && obj.narrative.trim()) return obj.narrative.trim();
    } catch {
      /* fall through to raw-text fallback below */
    }
  }
  return text.trim();
}

/**
 * Deterministic, zero-cost stand-in for the demo/showcase account — mirrors
 * adversarial.ts's simulateAdversarialScenarios exactly: without this
 * branch, the demo org (which by design has no real provider key) could
 * exercise every other model-calling feature in this codebase
 * (playground/evals/pairwise/adversarial) except this one, and "Explain
 * this" would just 502 on the one account /enterprise and other marketing
 * pages point people to for exploring the product. Seeded from the run id
 * so the same demo run always gets the same narrative, not a random one on
 * every click.
 */
export function simulateRootCauseNarrative(ctx: ModelDiffNarrativeContext): RootCauseNarrativeResult {
  const seed = demoHash(ctx.runId);
  const templates: ((c: ModelDiffNarrativeContext) => string)[] = [
    (c) => `On ${c.modelB}, ${c.agentName} now resolves this case directly instead of the tool call it made on ${c.modelA} — a ${c.divergenceCategory.replace("_", " ")} change. ${c.divergenceReason} This matters because a decision that used to route through a checked tool path now happens without it, changing what evidence exists for the same outcome.`,
    (c) => `${c.agentName}'s behavior changed between ${c.modelA} and ${c.modelB}: ${c.divergenceReason} Classified as ${c.divergenceCategory.replace("_", " ")} at severity ${c.divergenceSeverity}/100 — high enough that this is a behavioral shift worth reviewing before the new model handles this case class in production, not background noise from normal model variance.`,
    (c) => `The two models disagree on this case in a way that isn't just wording: ${c.divergenceReason} (${c.divergenceCategory.replace("_", " ")}). Anyone relying on ${c.agentName} to behave consistently across a model upgrade should treat this specific case class as needing a manual check, not an automatic pass.`,
  ];
  return { text: templates[seed % templates.length](ctx), modelId: "demo-simulated" };
}

/**
 * Generate a root-cause narrative for a model-diff divergence. Deterministic
 * in spirit (temperature 0) — a narrative explaining a deterministic
 * divergence shouldn't itself introduce creative variance. Throws only on a
 * total inability to call a model (no key, provider error) — the caller
 * (the API route) decides how to surface that; this function never silently
 * returns an empty/placeholder narrative that could get sealed as if real.
 */
export async function generateRootCauseNarrative(
  ctx: ModelDiffNarrativeContext,
  keys?: Partial<Record<Provider, string>>,
  demo?: boolean
): Promise<RootCauseNarrativeResult> {
  if (demo) return simulateRootCauseNarrative(ctx);
  const modelId = pickNarrativeModel(keys);
  const model = resolveModel(modelId, "groq", keys);
  const prompt = buildRootCauseNarrativePrompt(ctx);
  const { text } = await generateText({ model, prompt, temperature: 0 });
  const narrative = parseNarrativeReply(text);
  if (!narrative) {
    throw new Error("[narrative] model returned an empty narrative — refusing to seal an empty explanation");
  }
  return { text: narrative, modelId };
}

/**
 * The compliance-narrative half of the same sealing pair (see module doc) —
 * explains what a named regulatory control's live evidence actually shows,
 * for an auditor or examiner reading it cold. Reuses generateRootCauseNarrative's
 * exact provider-picking/parsing/demo conventions; only the prompt and input
 * shape differ, since the underlying claim ("an AI wrote this, and it's
 * cryptographically pinned to the evidence it describes") is identical.
 */
export interface ComplianceNarrativeContext {
  frameworkName: string;
  clause: string;
  requirement: string;
  runbackCapability: string;
  evidenceType: string;
  evidenceCount: number;
  evidenceSample: string[];
}

function buildComplianceNarrativePrompt(ctx: ComplianceNarrativeContext): string {
  const sampleLines = ctx.evidenceSample.length > 0 ? ctx.evidenceSample.map((s) => `- ${s}`).join("\n") : "(no evidence recorded yet)";
  return `You are explaining, for an auditor or regulatory examiner, whether a specific compliance control is actually satisfied by an organization's real system evidence — not a policy statement, the evidence itself.

CONTROL: ${ctx.frameworkName} — ${ctx.clause}
REQUIREMENT: ${ctx.requirement}
HOW THIS SYSTEM CLAIMS TO SATISFY IT: ${ctx.runbackCapability}

FACTS — the actual evidence on record (do not invent anything beyond these; if the count is 0, say so plainly, don't soften it):
- Evidence type: ${ctx.evidenceType}
- Total evidence count (last 90 days): ${ctx.evidenceCount}
- Specific evidence sampled:
${sampleLines}

Write 2-4 sentences, addressed to the examiner: (1) what the evidence concretely shows (cite the specific items above, not just the count), (2) whether that evidence plausibly satisfies the stated requirement or falls short, (3) if it falls short, say so directly — do not spin a gap into a strength. Do not recommend next steps — that belongs in a separate remediation feature. Respond with ONLY a JSON object: {"narrative": "<your 2-4 sentences>"}`;
}

export interface ComplianceNarrativeResult {
  text: string;
  modelId: string;
}

/**
 * Deterministic, zero-cost stand-in for the demo/showcase account — same
 * reasoning as simulateRootCauseNarrative: the showcase org has no real
 * provider key, and a compliance-focused demo account is exactly the one
 * that would exercise this feature first.
 */
export function simulateComplianceNarrative(ctx: ComplianceNarrativeContext): ComplianceNarrativeResult {
  const seed = demoHash(`${ctx.frameworkName}:${ctx.clause}`);
  const hasEvidence = ctx.evidenceCount > 0;
  const templates: ((c: ComplianceNarrativeContext) => string)[] = [
    (c) => hasEvidence
      ? `${c.frameworkName} ${c.clause} requires ${c.requirement.charAt(0).toLowerCase()}${c.requirement.slice(1)} — the system currently has ${c.evidenceCount} recorded ${c.evidenceType.replace("_", " ")} evidence item(s), including ${c.evidenceSample[0] ?? "recent activity"}. This is real, system-generated evidence rather than a self-attestation, which plausibly satisfies the recordkeeping intent of the requirement.`
      : `${c.frameworkName} ${c.clause} requires ${c.requirement.charAt(0).toLowerCase()}${c.requirement.slice(1)} — no ${c.evidenceType.replace("_", " ")} evidence has been recorded for this organization in the last 90 days. This control is not currently supported by any evidence and should be treated as an open gap, not a pass.`,
    (c) => hasEvidence
      ? `Reviewing the evidence behind "${c.runbackCapability}": ${c.evidenceCount} ${c.evidenceType.replace("_", " ")} record(s) exist, for example ${c.evidenceSample[0] ?? "a recent entry"}. That is concrete, system-captured evidence directly relevant to ${c.clause}, though an examiner should still confirm coverage matches the full scope of the requirement text.`
      : `Reviewing the evidence behind "${c.runbackCapability}" for ${c.clause}: there is none on record for this organization in the last 90 days. The capability may exist, but without recorded evidence an examiner cannot verify it was actually exercised.`,
  ];
  return { text: templates[seed % templates.length](ctx), modelId: "demo-simulated" };
}

export async function generateComplianceNarrative(
  ctx: ComplianceNarrativeContext,
  keys?: Partial<Record<Provider, string>>,
  demo?: boolean
): Promise<ComplianceNarrativeResult> {
  if (demo) return simulateComplianceNarrative(ctx);
  const modelId = pickNarrativeModel(keys);
  const model = resolveModel(modelId, "groq", keys);
  const prompt = buildComplianceNarrativePrompt(ctx);
  const { text } = await generateText({ model, prompt, temperature: 0 });
  const narrative = parseNarrativeReply(text);
  if (!narrative) {
    throw new Error("[narrative] model returned an empty compliance narrative — refusing to seal an empty explanation");
  }
  return { text: narrative, modelId };
}
