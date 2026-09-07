import "dotenv/config";
import type { TraceEvent } from "@runback/schema";

/**
 * Seeds a realistic, hand-authored failing run so the UI can be explored without
 * a Groq key. Mirrors what the demo agent produces: research → fetch → email,
 * failing at send_email because the model passed a malformed address.
 *
 *   npm run seed
 */

// Stable by default so `/runs/demo-email-agent` is a durable, linkable public
// demo URL. Ingest upserts on (run_id) / (run_id,span_id) with
// ignoreDuplicates, so re-running against the same id is a safe no-op.
// Override for a fresh id when testing locally.
const RUN_ID = process.env.FIXTURE_RUN_ID ?? "demo-email-agent";
const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

const v = 1 as const;
const SYSTEM =
  "You are a research assistant agent. Given a task, you:\n1. Use web_search to find sources.\n2. Use fetch_url to read the most relevant result.\n3. Write a concise 3-sentence summary.\n4. Use send_email to send it to the address given in the task.";

const TOOLS = [
  {
    name: "web_search",
    description: "Search the web. Returns result snippets.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "fetch_url",
    description: "Fetch readable text of a URL.",
    parameters: { type: "object", properties: { url: { type: "string" } } },
  },
  {
    name: "send_email",
    description: "Send an email. `to` must be a valid address.",
    parameters: {
      type: "object",
      properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
    },
  },
];

const TASK =
  "Research Next.js 16 and email a 3-sentence summary to jordan[at]example.com";

const events: TraceEvent[] = [
  {
    schema_version: v,
    run_id: RUN_ID,
    span_id: "r0",
    parent_span_id: null,
    seq: 0,
    ts_start: iso(0),
    ts_end: null,
    type: "run",
    phase: "start",
    name: "research-email-agent",
    input: TASK,
    output: null,
    status: "running",
    error: null,
    metadata: { example: "fixture", sdk: "@runback/sdk@0.1.0" },
  },
  // step 1: model decides to search
  {
    schema_version: v,
    run_id: RUN_ID,
    span_id: "l1",
    parent_span_id: "r0",
    seq: 1,
    ts_start: iso(20),
    ts_end: iso(440),
    type: "llm",
    model: { provider: "groq", model_id: "llama-3.3-70b-versatile" },
    request: {
      system: SYSTEM,
      messages: [{ role: "user", content: TASK }],
      tools: TOOLS,
      params: { temperature: 0.7 },
    },
    response: {
      text: null,
      reasoning: null,
      finish_reason: "tool-calls",
      tool_calls: [
        { tool_call_id: "tc1", tool_name: "web_search", input: { query: "Next.js 16 features" } },
      ],
    },
    usage: { input_tokens: 712, output_tokens: 28, total_tokens: 740 },
    latency_ms: 420,
    error: null,
  },
  {
    schema_version: v,
    run_id: RUN_ID,
    span_id: "t1",
    parent_span_id: "l1",
    seq: 2,
    ts_start: iso(450),
    ts_end: iso(465),
    type: "tool",
    tool_name: "web_search",
    tool_call_id: "tc1",
    input: { query: "Next.js 16 features" },
    output: {
      results: [
        {
          title: "Next.js 16 Release Notes",
          url: "https://nextjs.org/blog/next-16",
          snippet: "Async params/searchParams, Cache Components stable, Turbopack default.",
        },
      ],
    },
    latency_ms: 15,
    error: null,
  },
  // step 2: model reads the page
  {
    schema_version: v,
    run_id: RUN_ID,
    span_id: "l2",
    parent_span_id: "r0",
    seq: 3,
    ts_start: iso(470),
    ts_end: iso(900),
    type: "llm",
    model: { provider: "groq", model_id: "llama-3.3-70b-versatile" },
    request: {
      system: SYSTEM,
      messages: [
        { role: "user", content: TASK },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "web_search", input: { query: "Next.js 16 features" } },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "tc1",
              toolName: "web_search",
              output: { results: [{ url: "https://nextjs.org/blog/next-16" }] },
            },
          ],
        },
      ],
      tools: TOOLS,
      params: { temperature: 0.7 },
    },
    response: {
      text: null,
      reasoning: null,
      finish_reason: "tool-calls",
      tool_calls: [
        { tool_call_id: "tc2", tool_name: "fetch_url", input: { url: "https://nextjs.org/blog/next-16" } },
      ],
    },
    usage: { input_tokens: 845, output_tokens: 31, total_tokens: 876 },
    latency_ms: 430,
    error: null,
  },
  {
    schema_version: v,
    run_id: RUN_ID,
    span_id: "t2",
    parent_span_id: "l2",
    seq: 4,
    ts_start: iso(905),
    ts_end: iso(918),
    type: "tool",
    tool_name: "fetch_url",
    tool_call_id: "tc2",
    input: { url: "https://nextjs.org/blog/next-16" },
    output: {
      url: "https://nextjs.org/blog/next-16",
      content:
        "Next.js 16 highlights: async params/searchParams, Cache Components stable, Turbopack default, React 19.2 support.",
    },
    latency_ms: 13,
    error: null,
  },
  // step 3: model composes + sends email — with a MALFORMED address
  {
    schema_version: v,
    run_id: RUN_ID,
    span_id: "l3",
    parent_span_id: "r0",
    seq: 5,
    ts_start: iso(925),
    ts_end: iso(1380),
    type: "llm",
    model: { provider: "groq", model_id: "llama-3.3-70b-versatile" },
    request: {
      system: SYSTEM,
      messages: [
        { role: "user", content: TASK },
        { role: "assistant", content: "Found the release notes and read the page. Composing the summary email now." },
      ],
      tools: TOOLS,
      params: { temperature: 0.7 },
    },
    response: {
      text: null,
      reasoning:
        "The task says to email jordan[at]example.com. I'll pass that string directly as the recipient.",
      finish_reason: "tool-calls",
      tool_calls: [
        {
          tool_call_id: "tc3",
          tool_name: "send_email",
          input: {
            to: "jordan[at]example.com",
            subject: "Next.js 16 — quick summary",
            body:
              "Next.js 16 makes params/searchParams async, stabilizes Cache Components, and ships Turbopack as the default bundler. It supports React 19.2. Upgrade by awaiting dynamic params in pages and route handlers.",
          },
        },
      ],
    },
    usage: { input_tokens: 902, output_tokens: 96, total_tokens: 998 },
    latency_ms: 455,
    error: null,
  },
  {
    schema_version: v,
    run_id: RUN_ID,
    span_id: "t3",
    parent_span_id: "l3",
    seq: 6,
    ts_start: iso(1385),
    ts_end: iso(1389),
    type: "tool",
    tool_name: "send_email",
    tool_call_id: "tc3",
    input: {
      to: "jordan[at]example.com",
      subject: "Next.js 16 — quick summary",
      body: "Next.js 16 makes params/searchParams async...",
    },
    output: null,
    latency_ms: 4,
    error: {
      name: "Error",
      message:
        'SMTP 550: invalid recipient address "jordan[at]example.com". Expected a valid email like name@domain.com.',
    },
  },
  {
    schema_version: v,
    run_id: RUN_ID,
    span_id: "r9",
    parent_span_id: "r0",
    seq: 7,
    ts_start: iso(1390),
    ts_end: iso(1392),
    type: "run",
    phase: "end",
    name: "research-email-agent",
    input: null,
    output: null,
    status: "error",
    error: {
      name: "Error",
      message:
        'SMTP 550: invalid recipient address "jordan[at]example.com". Expected a valid email like name@domain.com.',
    },
    metadata: {},
  },
];

async function main() {
  const base = (process.env.RUNBACK_INGEST_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const apiKey = process.env.RUNBACK_API_KEY;
  if (!apiKey) {
    console.error("Missing RUNBACK_API_KEY. See README setup.");
    process.exit(1);
  }
  const res = await fetch(`${base}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) {
    console.error("Seed failed:", res.status, await res.text());
    process.exit(1);
  }
  console.log(`\n✓ Seeded fixture run (idempotent — safe to re-run).\n🔍 ${base}/runs/${RUN_ID}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
