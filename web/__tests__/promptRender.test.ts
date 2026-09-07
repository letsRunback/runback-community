import { describe, it, expect } from "vitest";
import { extractVariableNames, validateVariables, interpolateTemplate, type PromptMessage } from "../lib/prompts/render";

const TEMPLATE: PromptMessage[] = [
  { role: "system", content: "You are a support agent for {{company}}." },
  { role: "user", content: "Customer: {{customer_message}} (ticket {{ticket_id}})" },
];

describe("prompt render", () => {
  it("extractVariableNames finds every {{var}}, deduped, first-seen order", () => {
    expect(extractVariableNames(TEMPLATE)).toEqual(["company", "customer_message", "ticket_id"]);
    expect(extractVariableNames([{ role: "user", content: "no vars here" }])).toEqual([]);
  });

  it("validateVariables reports only required variables missing a value and no default", () => {
    const vars = [
      { name: "company", required: true },
      { name: "ticket_id", required: true, default: "unknown" },
      { name: "note", required: false },
    ];
    expect(validateVariables(vars, {})).toEqual(["company"]);
    expect(validateVariables(vars, { company: "Acme" })).toEqual([]);
  });

  it("interpolateTemplate substitutes provided values, falls back to defaults, then empty string", () => {
    const rendered = interpolateTemplate(
      TEMPLATE,
      [{ name: "ticket_id", required: true, default: "N/A" }],
      { company: "Acme", customer_message: "where is my order" }
    );
    expect(rendered[0].content).toBe("You are a support agent for Acme.");
    expect(rendered[1].content).toBe("Customer: where is my order (ticket N/A)");
  });

  it("interpolateTemplate leaves an unmatched variable as an empty string", () => {
    const rendered = interpolateTemplate(TEMPLATE, [], {});
    expect(rendered[0].content).toBe("You are a support agent for .");
  });
});
