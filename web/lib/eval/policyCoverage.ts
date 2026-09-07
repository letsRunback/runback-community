/**
 * Coverage-gap analysis — the pure logic, no DB (see lib/policyCoverage.ts for
 * the data layer). "The live blocking only catches what you've written a rule
 * for" is an honest, permanent limit of a deterministic policy engine. What's
 * NOT permanent is not knowing where the blind spots actually are. This turns
 * "did we think of everything?" into a computed list: which tools your agents
 * actually called have no rule that even mentions them, so nothing could have
 * blocked a bad call to them even in principle — ranked by how often they're
 * actually used, so the biggest live blind spot sorts to the top.
 */
import type { Predicate, PolicyRule } from "./policy";

function collectReferencedTools(pred: Predicate, out: Set<string>): void {
  // Defensive: a policy row written before importTemplate() started calling
  // assertValidPolicy() (or corrupted any other way) can hold a rule in the
  // pre-fix Policy Library shape ({type, tool, condition, message} — see
  // policyLibrary.ts and sql/fix_policy_template_shape.sql), which has no
  // `.op` at all. One bad rule crashing coverage-gap analysis or anomaly
  // detection for the ENTIRE org — every other rule, every other policy —
  // is a worse failure than silently not crediting that one rule as
  // "covering" anything, which is what happens by just skipping it here.
  if (!pred || typeof (pred as { op?: unknown }).op !== "string") return;
  switch (pred.op) {
    case "tool_called":
    case "tool_arg":
      out.add(pred.tool);
      return;
    case "and":
      if (Array.isArray(pred.all)) for (const p of pred.all) collectReferencedTools(p, out);
      return;
    case "or":
      if (Array.isArray(pred.any)) for (const p of pred.any) collectReferencedTools(p, out);
      return;
    case "not":
      if (pred.pred) collectReferencedTools(pred.pred, out);
      return;
    // output_matches / input_matches / finish_reason / tool_call_count /
    // no_error don't name a specific tool — deliberately not credited as
    // "covering" any tool here. A rule built only from these evaluates on
    // every decision, but knowing "some generic rule exists" doesn't tell you
    // whether a SPECIFIC dangerous tool call would actually be caught, which
    // is the question this analysis exists to answer.
    default:
      return;
  }
}

/** Every tool name referenced by a tool_called/tool_arg predicate anywhere in `rules`. */
export function toolsCoveredByRules(rules: PolicyRule[]): Set<string> {
  const out = new Set<string>();
  for (const rule of rules) {
    if (rule.kind === "assert") collectReferencedTools(rule.pred, out);
    else {
      collectReferencedTools(rule.when, out);
      collectReferencedTools(rule.then, out);
    }
  }
  return out;
}

export interface ToolUsage {
  tool_name: string;
  count: number;
}

export type CoverageGap = ToolUsage;

/** Tools actually called that no active rule names — sorted by call volume, most-used first. */
export function computeCoverageGaps(rules: PolicyRule[], usage: ToolUsage[]): CoverageGap[] {
  const covered = toolsCoveredByRules(rules);
  return usage
    .filter((u) => !covered.has(u.tool_name))
    .sort((a, b) => b.count - a.count);
}
