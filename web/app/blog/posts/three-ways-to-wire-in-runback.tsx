import Link from "next/link";
import CodeBlock from "@/components/site/CodeBlock";

function DecisionDiagram() {
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 180" role="img" aria-labelledby="wire-in-diagram-title">
        <title id="wire-in-diagram-title">Three integration paths: Vercel AI SDK, OpenTelemetry, or the manual recorder</title>

        <rect x="10" y="15" width="185" height="150" rx="8" fill="rgba(232,135,61,0.05)" stroke="var(--brand)" strokeWidth={1.2} />
        <text x="102" y="36" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--brand)">on Vercel AI SDK?</text>
        <text x="102" y="58" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-secondary)">withDebugger()</text>
        <text x="102" y="74" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-secondary)">~3 lines</text>
        <text x="102" y="100" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">deepest capture:</text>
        <text x="102" y="114" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">context, redaction,</text>
        <text x="102" y="128" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">step replay</text>

        <rect x="227" y="15" width="185" height="150" rx="8" fill="rgba(62,207,184,0.05)" stroke="var(--brand-2)" strokeWidth={1.2} />
        <text x="319" y="36" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--brand-2)">LangChain / CrewAI /</text>
        <text x="319" y="50" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--brand-2)">LlamaIndex / raw SDKs?</text>
        <text x="319" y="74" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-secondary)">OpenTelemetry exporter</text>
        <text x="319" y="100" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">zero code changes to</text>
        <text x="319" y="114" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">your calls — instrument</text>
        <text x="319" y="128" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">the library, not the app</text>

        <rect x="444" y="15" width="185" height="150" rx="8" fill="rgba(16,185,129,0.05)" stroke="var(--emerald)" strokeWidth={1.2} />
        <text x="536" y="36" textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--emerald)">your own agent loop?</text>
        <text x="536" y="58" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-secondary)">startRun()</text>
        <text x="536" y="74" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-secondary)">manual recorder</text>
        <text x="536" y="100" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">no framework</text>
        <text x="536" y="114" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">requirement — record</text>
        <text x="536" y="128" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">steps by hand</text>
      </svg>
      <figcaption className="blog-figcaption">
        All three paths write to the same run format — the inspector, replay, and evals don&apos;t
        know or care which one you used.
      </figcaption>
    </figure>
  );
}

export default function ThreeWaysToWireInRunback() {
  return (
    <>
      <p className="blog-p">
        Runback doesn&apos;t replace LangChain, CrewAI, or the Vercel AI SDK — it governs whatever
        you built on top of them. Which integration you use depends entirely on what your agent is
        already running on. Here&apos;s how to pick, with the actual commands for each.
      </p>

      <h2 className="blog-h2">1. On the Vercel AI SDK: <code>withDebugger</code></h2>
      <p className="blog-p">
        If your agent calls <code>generateText</code> or <code>streamText</code> from the{" "}
        <code>ai</code> package, this is the deepest integration Runback has. It wraps your model
        with <code>wrapLanguageModel</code>, so every request and response — the full{" "}
        <code>messages</code> array, system prompt, and in-scope tool definitions — is captured at
        the exact boundary the model saw it, not reconstructed after the fact.
      </p>
      <CodeBlock label="agent.ts">{`import { withDebugger } from "@runback/sdk";
import { generateText, stepCountIs } from "ai";

const dbg = withDebugger(model, { runName: "my-agent", redact: "standard" });

const result = await generateText({
  model: dbg.model,
  tools: dbg.tools(myTools),      // wraps tool.execute to capture input/output/latency
  stopWhen: stepCountIs(8),
  prompt: task,
});

await dbg.finish({ output: result.text, status: "success" });`}</CodeBlock>
      <p className="blog-p">
        That&apos;s the whole integration. <code>dbg.tools(myTools)</code> is what makes tool
        spans and causal links work — clicking a tool call in the inspector jumps straight to the
        LLM step that requested it, via <code>tool_call_id</code>. This is also the only path that
        supports <strong>replay-from-step-N</strong>: because the exact captured request is stored,
        Runback can re-issue it, or let you edit it and see how the model responds differently.
      </p>

      <h2 className="blog-h2">2. Any other framework: OpenTelemetry</h2>
      <p className="blog-p">
        LangChain, CrewAI, and LlamaIndex agents (JS or Python) don&apos;t need code changes at the
        call site — instrument the library itself with an OpenTelemetry GenAI exporter (OpenLLMetry
        or OpenInference both work) and point it at Runback&apos;s OTLP endpoint:
      </p>
      <CodeBlock label=".env">{`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://runback.dev/api/otel/v1/traces"
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL="http/json"
OTEL_EXPORTER_OTLP_TRACES_HEADERS="authorization=Bearer <RUNBACK_API_KEY>"`}</CodeBlock>
      <CodeBlock label="LangChain — Python">{`pip install openinference-instrumentation-langchain \\
            opentelemetry-exporter-otlp-proto-http

# LangChainInstrumentor().instrument() — then the env vars above`}</CodeBlock>
      <CodeBlock label="CrewAI — Python">{`pip install traceloop-sdk
# Traceloop.init(api_endpoint=..., headers=...) — CrewAI spans flow straight in`}</CodeBlock>
      <p className="blog-p">
        This is the right default when you&apos;re not on the AI SDK, or you&apos;re instrumenting
        a framework in a language other than TypeScript. If it emits GenAI-convention spans,
        Runback reads it — the trade-off is that you don&apos;t get the AI SDK path&apos;s
        replay-from-step-N, since the exact request/response boundary isn&apos;t captured the same
        way a middleware wrap captures it.
      </p>

      <h2 className="blog-h2">3. A custom agent loop: <code>startRun</code></h2>
      <p className="blog-p">
        No framework, no AI SDK — just your own loop calling a model directly. Record steps by
        hand with the framework-agnostic recorder:
      </p>
      <CodeBlock label="agent.ts">{`import { startRun } from "@runback/sdk";

const run = startRun({ runName: "my-agent", input: task });

run.llm({
  model: { provider: "openai", model_id: "gpt-4o" },
  request: { messages, tools },
  response: { text, tool_calls },
  usage: { input_tokens, output_tokens, total_tokens },
  latencyMs,
});

run.tool({ toolName: "search", toolCallId: "1", input, output, latencyMs });

await run.finish({ output, status: "success" });`}</CodeBlock>
      <p className="blog-p">
        You control exactly what gets recorded and when — useful for loops that don&apos;t map
        cleanly onto a single library&apos;s instrumentation hooks, or when you only want to record
        a subset of steps.
      </p>

      <DecisionDiagram />

      <div className="blog-pullquote">
        Whichever path you pick writes to the same run format. The inspector, replay engine, and
        eval gate don&apos;t know or care how a run was captured.
      </div>

      <h2 className="blog-h2">So what?</h2>
      <p className="blog-p">
        Most teams end up mixing paths — the AI SDK for the agent doing the interesting work, an
        OpenTelemetry exporter for a LangChain tool it calls into, maybe <code>startRun</code> for
        one bespoke loop nobody wants to refactor. That&apos;s fine. Pick the path that matches
        what you have today; you&apos;re not locked into it.
      </p>
      <p className="blog-p">
        Full reference, model list, and how Runback connects out to CI, SSO, and alerting once
        runs are captured: <Link href="/integrations" className="up-link-blue">see the integrations page →</Link>
      </p>
    </>
  );
}
