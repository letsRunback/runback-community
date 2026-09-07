# @runback/sdk

Capture, replay, and audit every AI agent decision.

Runback records what your agent saw, what it decided, and why — then lets you re-execute any step deterministically from the exact captured context. Every run is sealed into a tamper-evident cassette that satisfies EU AI Act Art. 12 and APRA CPS 230.

## Install

```bash
npm install @runback/sdk
```

`ai` (the Vercel AI SDK) is an **optional** peer. You only need it for
`withDebugger()`. To record runs from any other agent loop, import from
`@runback/sdk/core` and nothing else is required:

```ts
import { startRun } from "@runback/sdk/core";
```

## 3-line quickstart (Vercel AI SDK)

```ts
import { withDebugger } from "@runback/sdk";

const dbg = withDebugger(openai("gpt-4o"), {
  runName: "support-agent",
  // Redaction (emails, cards, keys) is ON by default — shown explicitly here
  // for clarity. Pass `redact: false` to disable it.
  redact: "standard",
});

const result = await generateText({
  model: dbg.model,
  tools: dbg.tools(myTools),
  prompt: task,
});

await dbg.finish({ output: result.text, status: "success" });
// → run appears at https://runback.dev/runs
```

## Framework-agnostic (any agent loop)

```ts
import { startRun } from "@runback/sdk";

const run = startRun({ runName: "loan-agent", input: application, redact: "standard" });

// record each LLM call manually
run.llm({
  model: { provider: "anthropic", model_id: "claude-sonnet-4-6" },
  request: { messages, tools },
  response: { text, tool_calls, finish_reason },
  usage: { input_tokens, output_tokens, total_tokens },
  latencyMs,
});

// record tool calls
run.tool({ toolName: "credit_check", input: params, output: result, latencyMs });

await run.finish({ output: decision, status: "success" });
```

`startRun()`/`run.llm()`/`run.tool()` above are plain function calls — call
them from LangChain, LangGraph, AutoGen, Mastra, CrewAI, or any other
framework's own callback/hook, or from a raw model-API call. This is manual
wiring, not auto-instrumentation: only `withDebugger()` (the Vercel AI SDK
path, above) captures automatically from inside this package.

If your framework already emits OpenTelemetry GenAI spans (LangGraph,
CrewAI, OpenLLMetry/Traceloop, OpenInference, ...), you don't need this SDK
at all — point your OTLP/HTTP exporter directly at Runback's ingest endpoint
instead: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://<host>/api/otel`. That
receiver lives in the Runback platform, not in this npm package.

## Policy enforcement (block before it runs)

```ts
const dbg = withDebugger(model, {
  runName: "refund-agent",
  enforce: [
    {
      id: "require-escalation-before-refund",
      description: "Refunds > $500 require escalate_to_human to have run first",
      predicate: ({ toolName, priorTools }) =>
        toolName === "issue_refund" &&
        !priorTools.includes("escalate_to_human"),
      action: "block",
    },
  ],
});
```

The gate runs **before** the tool executes — synchronous, no network in your agent's critical path. Every block is sealed into the cassette as a re-runnable proof.

## Environment variables

```bash
RUNBACK_API_KEY=rk_...          # from runback.dev/app/settings
RUNBACK_INGEST_URL=...          # default: https://runback.dev/api/ingest
                                # self-hosted: your own endpoint
```

## Redaction

```ts
// standard: API keys, emails, credit cards (Luhn-checked), SSNs
withDebugger(model, { runName: "...", redact: "standard" })

// strict: adds phone numbers and IP addresses
withDebugger(model, { runName: "...", redact: "strict" })

// custom patterns
withDebugger(model, { runName: "...", redact: { custom: [/ACCT-\d{8}/g] } })
```

PII is stripped **inside your process** before anything is sent to Runback or written to disk.

## Self-hosted

Run Runback entirely in your own infrastructure. Your traces never leave your perimeter.

```bash
# one-command self-host
docker compose up

# then point the SDK at your own ingest endpoint
RUNBACK_INGEST_URL=http://localhost:4000/api/ingest
```

Full self-host docs: [runback.dev/docs](https://runback.dev/docs)

## What you get

- **Replay** — re-execute any run from its exact captured context. A different output on replay means behaviour changed. Root cause in minutes.
- **Policy gates** — block non-compliant actions before they execute. The block is sealed into the cassette.
- **Signed audit cassette** — SHA-256 hash-chained, HMAC-signed. Verifiable without a Runback account. Satisfies EU AI Act Art. 12 mandatory logging.
- **CI release gate** — run your golden suite against every model or prompt change. A failing policy blocks the deploy.

## Links

- **Dashboard**: [runback.dev/app](https://runback.dev/app)
- **Docs**: [runback.dev/docs](https://runback.dev/docs)
- **Self-host**: [runback.dev/get-started](https://runback.dev/get-started)
- **Enterprise / compliance**: [runback.dev/enterprise](https://runback.dev/enterprise)
- **Demo runs** (no signup): [runback.dev/runs](https://runback.dev/runs)

---

MIT for the SDK. The managed platform and Enterprise self-host are commercial. See [runback.dev/pricing](https://runback.dev/pricing).
