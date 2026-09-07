/**
 * Policy-simulation core — the PURE evaluation logic (no DB), so it is unit-
 * testable in isolation. `policySim.ts` adds the data layer (load recent runs)
 * around this.
 */
import { inputTextOf, enforcePolicy, type PolicyRule, type PendingCall } from "./policy";
import type { ReplayedOutput } from "./scorers";
import type { LlmEvent } from "@runback/schema";

export interface PolicySimRun {
  run_id: string;
  name: string | null;
  /** The first failing rule's detail — what the policy would have caught. */
  detail: string;
}
export interface PolicySimResult {
  total: number;
  blocked: number;
  allowed: number;
  notApplicable: number;
  blockRate: number;
  affected: PolicySimRun[];
}

/** Turn one recorded LLM decision into the flat shape the policy engine reads. */
export function outputOf(llm: LlmEvent): ReplayedOutput {
  return {
    text: llm.response.text ?? null,
    finish_reason: llm.response.finish_reason ?? null,
    tool_calls: (llm.response.tool_calls ?? []).map((t) => ({ tool_name: t.tool_name, input: t.input })),
    latency_ms: llm.latency_ms ?? null,
    total_tokens: llm.usage?.total_tokens ?? null,
    error: llm.error ? { message: llm.error.message } : null,
  };
}

/**
 * Pure: would this policy block a run, given its recorded LLM decisions (in
 * run order)?
 *
 * Calls the SAME enforcePolicy the SDK's runtime pre-hook calls, rather than
 * re-implementing the check — so simulation and live enforcement can never
 * drift apart again. That matters because the two are NOT interchangeable to
 * re-derive: live enforcement only ever fires as a pre-hook right before a
 * pending tool call, checked against every tool call already made THIS RUN —
 * not per LLM turn in isolation, and never for a rule that doesn't involve a
 * tool call at all (a "no error in the output" assert, say, is never actually
 * checked live, because there's no tool call to hook it to). Evaluating each
 * decision's full output independently — the previous approach — could show a
 * `require` rule "blocking" in simulation when live enforcement would never
 * even have run it, because its antecedent and consequent tool calls landed
 * in different model turns, the normal case for a multi-step agent.
 */
export function wouldBlock(decisions: LlmEvent[], rules: PolicyRule[]): { blocked: boolean; detail: string | null } {
  const priorCalls: PendingCall[] = [];
  for (const llm of decisions) {
    const inputText = inputTextOf(llm.request);
    for (const call of outputOf(llm).tool_calls) {
      const decision = enforcePolicy(rules, priorCalls, call, inputText);
      if (!decision.allowed) {
        return { blocked: true, detail: decision.rule ? `${decision.rule}: ${decision.detail}` : (decision.detail ?? "policy violated") };
      }
      priorCalls.push(call);
    }
  }
  return { blocked: false, detail: null };
}
