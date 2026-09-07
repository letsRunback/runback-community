/** {{var}} interpolation for prompt templates — no engine, just substitution. */

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptVariable {
  name: string;
  required?: boolean;
  description?: string;
  default?: string;
}

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Every `{{name}}` referenced in a template, in first-seen order. */
export function extractVariableNames(template: PromptMessage[]): string[] {
  const seen = new Set<string>();
  for (const m of template) {
    for (const match of m.content.matchAll(VAR_RE)) seen.add(match[1]);
  }
  return [...seen];
}

/** Missing required variables — empty array means the values are complete enough to render. */
export function validateVariables(variables: PromptVariable[], values: Record<string, string>): string[] {
  return variables
    .filter((v) => v.required && !(v.name in values) && v.default === undefined)
    .map((v) => v.name);
}

/** Substitute `{{var}}` with its value (falling back to the variable's default, then ""). */
export function interpolateTemplate(
  template: PromptMessage[],
  variables: PromptVariable[],
  values: Record<string, string>
): PromptMessage[] {
  const defaults = new Map(variables.map((v) => [v.name, v.default ?? ""]));
  return template.map((m) => ({
    role: m.role,
    content: m.content.replace(VAR_RE, (_, name) => values[name] ?? defaults.get(name) ?? ""),
  }));
}
