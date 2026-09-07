/**
 * Runtime validation for incoming trace events (ingest boundary).
 * Mirrors the TypeScript types in events.ts. Permissive on payload shapes
 * (`input`/`output`/`content` are `unknown`) but strict on the envelope so
 * ordering, addressing, and tree reconstruction are always sound.
 */
import { z } from "zod";
import { SCHEMA_VERSION } from "./events";

const errorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.unknown(),
});

const toolDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.unknown(),
});

const usageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.number(),
});

const keyProjectionSchema = z.object({
  keep: z.array(z.string()).optional(),
  drop: z.array(z.string()).optional(),
});

const actorSchema = z.object({
  type: z.enum(["user", "api_key", "system"]),
  id: z.string(),
  label: z.string().optional(),
});

const base = {
  schema_version: z.literal(SCHEMA_VERSION),
  run_id: z.string().min(1),
  span_id: z.string().min(1),
  parent_span_id: z.string().nullable(),
  seq: z.number().int().nonnegative(),
  ts_start: z.string().min(1),
  ts_end: z.string().nullable(),
  // Was missing here: z.object() strips unrecognized keys by default, so
  // `actor` — real, SDK-populated (Collector.push stamps it on every event
  // for multi-tenant/compliance attribution) — was silently dropped at this
  // validation boundary. actor_type/actor_id were always null in the DB
  // regardless of what the SDK sent. See BaseEvent.actor in events.ts.
  actor: actorSchema.optional(),
};

const llmSchema = z.object({
  ...base,
  type: z.literal("llm"),
  model: z.object({ provider: z.string(), model_id: z.string() }),
  request: z.object({
    system: z.string().nullable(),
    messages: z.array(messageSchema),
    tools: z.array(toolDefSchema),
    params: z.object({
      temperature: z.number().optional(),
      max_output_tokens: z.number().optional(),
      top_p: z.number().optional(),
    }),
  }),
  response: z.object({
    text: z.string().nullable(),
    reasoning: z.string().nullable(),
    finish_reason: z.string().nullable(),
    tool_calls: z.array(
      z.object({
        tool_call_id: z.string(),
        tool_name: z.string(),
        input: z.unknown(),
      })
    ),
  }),
  usage: usageSchema.nullable(),
  latency_ms: z.number().nullable(),
  error: errorSchema.nullable(),
  key_projection: keyProjectionSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const toolSchema = z.object({
  ...base,
  type: z.literal("tool"),
  tool_name: z.string(),
  tool_call_id: z.string(),
  input: z.unknown(),
  output: z.unknown().nullable(),
  latency_ms: z.number().nullable(),
  error: errorSchema.nullable(),
  key_projection: keyProjectionSchema.optional(),
  policy_block: z.object({ rule: z.string(), detail: z.string() }).optional(),
  policy_evaluated: z.object({ passed: z.boolean() }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const reasoningSchema = z.object({
  ...base,
  type: z.literal("reasoning"),
  text: z.string(),
  label: z.string().nullable(),
  graph_node: z.object({
    name: z.string(),
    step: z.number().optional(),
    graph_name: z.string().optional(),
  }).optional(),
  routed_from: z.array(z.string()).optional(),
});

const runSchema = z.object({
  ...base,
  type: z.literal("run"),
  phase: z.enum(["start", "end"]),
  name: z.string(),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  status: z.enum(["running", "success", "error"]).nullable(),
  error: errorSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

const envSchema = z.object({
  ...base,
  type: z.literal("env"),
  kind: z.enum(["now", "date", "random", "uuid", "fetch"]),
  key: z.string(),
  output: z.unknown(),
});

export const traceEventSchema = z.discriminatedUnion("type", [
  llmSchema,
  toolSchema,
  reasoningSchema,
  runSchema,
  envSchema,
]);

export const ingestPayloadSchema = z.object({
  events: z.array(traceEventSchema).min(1).max(500),
});

export type ValidatedTraceEvent = z.infer<typeof traceEventSchema>;
