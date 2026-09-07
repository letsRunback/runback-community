/**
 * web/lib/eval/narrative.ts's pure parts — model picking and reply parsing.
 * Same conventions as judge.test.ts's pickJudgeModel/parseJudgeReply tests,
 * since narrative.ts deliberately mirrors judge.ts's discipline.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pickNarrativeModel, parseNarrativeReply, simulateRootCauseNarrative, simulateComplianceNarrative, type ModelDiffNarrativeContext, type ComplianceNarrativeContext } from "@/lib/eval/narrative";

describe("pickNarrativeModel", () => {
  const ENV_VARS = ["NARRATIVE_MODEL", "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
    for (const k of ENV_VARS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // NARRATIVE_MODEL_ENV is read once at module load (matching judge.ts's
  // identical JUDGE_MODEL_ENV pattern exactly) — judge.test.ts doesn't test
  // that override live either, for the same reason: setting the env var
  // after the module is already imported has no effect within one test run.

  it("prefers groq > openai > anthropic among available BYOK keys", () => {
    expect(pickNarrativeModel({ groq: "gk", openai: "ok", anthropic: "ak" })).toContain("gpt-oss");
    expect(pickNarrativeModel({ openai: "ok", anthropic: "ak" })).toBe("gpt-4o-mini");
    expect(pickNarrativeModel({ anthropic: "ak" })).toBe("claude-haiku-4-5-20251001");
  });

  it("falls back to a provider's env var when no BYOK key is passed", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(pickNarrativeModel(undefined)).toBe("gpt-4o-mini");
  });

  it("defaults to groq's model when nothing is configured anywhere", () => {
    expect(pickNarrativeModel(undefined)).toContain("gpt-oss");
  });
});

describe("parseNarrativeReply — tolerant, never throws", () => {
  it("parses a clean JSON object", () => {
    expect(parseNarrativeReply('{"narrative": "The agent now escalates instead of auto-approving."}'))
      .toBe("The agent now escalates instead of auto-approving.");
  });

  it("extracts JSON embedded in prose/code fences", () => {
    const text = 'Here is my analysis:\n```json\n{"narrative": "It changed the tool call."}\n```\nHope that helps!';
    expect(parseNarrativeReply(text)).toBe("It changed the tool call.");
  });

  it("falls back to the raw trimmed text when JSON parsing fails, rather than throwing", () => {
    const text = "  this is not json at all  ";
    expect(parseNarrativeReply(text)).toBe("this is not json at all");
  });

  it("falls back to raw text when the JSON object has no narrative field", () => {
    const text = '{"foo": "bar"}';
    expect(parseNarrativeReply(text)).toBe('{"foo": "bar"}');
  });

  it("ignores an empty-string narrative field and falls back to raw text", () => {
    const text = '{"narrative": "   "}';
    expect(parseNarrativeReply(text)).toBe(text.trim());
  });
});

describe("simulateRootCauseNarrative — deterministic demo stand-in", () => {
  const ctx: ModelDiffNarrativeContext = {
    agentName: "loan-approval-agent",
    modelA: "gpt-4o",
    modelB: "claude-sonnet-4-6",
    divergenceCategory: "tool_changed",
    divergenceSeverity: 95,
    divergenceReason: "now answers directly instead of calling escalate_to_human",
    verdict: "diverge",
    runId: "demo-run-1",
  };

  it("is fully deterministic for the same run id (no Math.random)", () => {
    const a = simulateRootCauseNarrative(ctx);
    const b = simulateRootCauseNarrative(ctx);
    expect(a.text).toBe(b.text);
  });

  it("never calls a real model — modelId is the demo sentinel", () => {
    expect(simulateRootCauseNarrative(ctx).modelId).toBe("demo-simulated");
  });

  it("incorporates the real context, not a generic placeholder", () => {
    const { text } = simulateRootCauseNarrative(ctx);
    expect(text).toContain(ctx.agentName);
    expect(text).toContain(ctx.divergenceReason);
  });

  it("different run ids can select different templates", () => {
    const texts = new Set(
      ["run-a", "run-b", "run-c", "run-d", "run-e"].map((runId) => simulateRootCauseNarrative({ ...ctx, runId }).text)
    );
    expect(texts.size).toBeGreaterThan(1);
  });
});

describe("simulateComplianceNarrative — deterministic demo stand-in", () => {
  const withEvidence: ComplianceNarrativeContext = {
    frameworkName: "EU AI Act",
    clause: "Article 12(1)",
    requirement: "High-risk AI systems shall be designed and developed with capabilities enabling the automatic recording of events.",
    runbackCapability: "Immutable run ledger (Merkle-chained)",
    evidenceType: "ledger",
    evidenceCount: 42,
    evidenceSample: ["ledger seq 100–870"],
  };
  const noEvidence: ComplianceNarrativeContext = { ...withEvidence, evidenceCount: 0, evidenceSample: [] };

  it("is fully deterministic for the same control (no Math.random)", () => {
    const a = simulateComplianceNarrative(withEvidence);
    const b = simulateComplianceNarrative(withEvidence);
    expect(a.text).toBe(b.text);
  });

  it("never calls a real model — modelId is the demo sentinel", () => {
    expect(simulateComplianceNarrative(withEvidence).modelId).toBe("demo-simulated");
  });

  it("incorporates the real requirement and evidence, not a generic placeholder", () => {
    const { text } = simulateComplianceNarrative(withEvidence);
    expect(text).toContain(withEvidence.evidenceSample[0]);
  });

  it("never claims evidence exists when the count is zero — states the gap plainly", () => {
    const { text } = simulateComplianceNarrative(noEvidence);
    expect(text.toLowerCase()).toMatch(/no .*evidence|not currently supported|without recorded evidence/);
  });

  it("a zero-evidence and populated-evidence context for the same control produce different text", () => {
    expect(simulateComplianceNarrative(withEvidence).text).not.toBe(simulateComplianceNarrative(noEvidence).text);
  });

  it("different clauses can select different templates", () => {
    const texts = new Set(
      ["Article 12(1)", "Article 9(1)", "Article 13(1)", "Article 14(1)"].map(
        (clause) => simulateComplianceNarrative({ ...withEvidence, clause }).text
      )
    );
    expect(texts.size).toBeGreaterThan(1);
  });
});
