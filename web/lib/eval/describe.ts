import type { ScorerConfig } from "./scorers";

/** One-line, human-readable summary of a scorer — for chips and result rows. */
export function describeScorer(cfg: ScorerConfig): string {
  switch (cfg.type) {
    case "exact_match":
      return `exactly "${truncate(cfg.expected)}"`;
    case "contains":
      return `contains "${truncate(cfg.value)}"`;
    case "not_contains":
      return `must not contain "${truncate(cfg.value)}"`;
    case "regex":
      return `matches /${truncate(cfg.pattern)}/`;
    case "tool_called":
      return `calls ${cfg.tool}()`;
    case "tool_not_called":
      return `must not call ${cfg.tool}()`;
    case "tool_arg":
      return `${cfg.tool}.${cfg.path} ${cfg.op}${cfg.value !== undefined ? ` ${truncate(JSON.stringify(cfg.value), 24)}` : ""}`;
    case "finish_reason":
      return `finish_reason = ${cfg.equals}`;
    case "no_error":
      return "no error";
    case "max_latency_ms":
      return `≤ ${cfg.budget}ms`;
    case "max_total_tokens":
      return `≤ ${cfg.budget} tokens`;
    case "json_valid":
      return "valid JSON output";
    case "json_schema":
      return `JSON shape${cfg.schema.type ? ` (${cfg.schema.type})` : ""}`;
    case "llm_judge":
      return cfg.criteria?.length
        ? `judge: ${cfg.criteria.length} criteria${cfg.samples && cfg.samples > 1 ? ` ×${cfg.samples}` : ""}`
        : `judge: ${truncate(cfg.rubric, 48)}`;
  }
}

function truncate(s: string, n = 32): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
