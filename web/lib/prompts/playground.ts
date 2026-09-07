/**
 * Playground — render a prompt template with real variable values and execute
 * it against one or more models. Zero new model-calling code: builds a
 * synthetic runStep() request per variant and reuses the exact same replay
 * core the debugger and the eval runner already depend on.
 */
import { getOrgKeys } from "@/lib/modelKeys";
import { runStep, replayModelAllowlist, type RunStepResult } from "@/lib/replay/runStep";
import { interpolateTemplate, validateVariables, type PromptMessage, type PromptVariable } from "./render";
import type { PromptModel } from "./prompts";

/** A playground run is a single POST — bound the worst-case fan-out regardless of what the caller sends. */
const MAX_COMPARE_MODELS = 4;

export interface PlaygroundInput {
  template: PromptMessage[];
  variables: PromptVariable[];
  values: Record<string, string>;
  model: PromptModel;
  /** {provider, model_id} params saved on the prompt version — temperature, top_p, max_output_tokens. */
  params?: Record<string, unknown>;
  /** Additional models to run the same rendered prompt against, alongside `model`. */
  compareModelIds?: string[];
  demo?: boolean;
}

export interface PlaygroundVariantResult extends RunStepResult {
  model_id: string;
}

/** Render the template, then execute it against the base model plus every compare model. */
export async function testPromptVariants(orgId: string, input: PlaygroundInput): Promise<PlaygroundVariantResult[]> {
  const missing = validateVariables(input.variables, input.values);
  if (missing.length) throw new Error(`Missing required variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);

  const rendered = interpolateTemplate(input.template, input.variables, input.values);
  const system = rendered.find((m) => m.role === "system")?.content ?? null;
  const messages = rendered.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));

  const request = { system, messages, tools: [], params: input.params ?? {} };
  const captured = { provider: input.model.provider, model_id: input.model.model_id };

  // Silently drop anything not in the replay allowlist rather than letting it
  // fall through to model_id: undefined — that would re-run the base model
  // once per garbage entry, so an unvalidated compare_model_ids list could
  // otherwise turn one request into an unbounded number of real model calls.
  const validCompare = (input.compareModelIds ?? [])
    .filter((id) => id !== input.model.model_id && replayModelAllowlist().includes(id))
    .slice(0, MAX_COMPARE_MODELS);
  const modelIds = [input.model.model_id, ...validCompare];
  const keys = input.demo ? undefined : await getOrgKeys(orgId);

  const results = await Promise.all(
    modelIds.map(async (model_id) => {
      const override = model_id !== input.model.model_id ? model_id : undefined;
      const result = await runStep({
        request,
        model: captured,
        model_id: override,
        demo: input.demo,
        keys,
      });
      return { ...result, model_id: override ?? input.model.model_id };
    })
  );

  return results;
}
