import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import InteractiveTrace from "@/components/site/InteractiveTrace";
import { IntegrationLogosFull } from "@/components/site/IntegrationLogos";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/integrations",
  title: "Connect your stack",
  description:
    "Connect any AI agent to Runback: the Vercel AI SDK, or any framework via OpenTelemetry. Model-agnostic.",
});

const OTEL_ENV = `export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://runback.dev/api/otel/v1/traces"
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL="http/json"
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="authorization=Bearer <RUNBACK_API_KEY>"`;

interface Integ {
  name: string;
  tag: string;
  blurb: string;
  code: string;
  lang?: string;
  /** Optional "see how it compares" link — only set when the integration
      target is itself a competing hosted platform (e.g. Traceloop), not a
      plain instrumentation library. */
  compareHref?: string;
  compareLabel?: string;
}

const SDK: Integ = {
  name: "Vercel AI SDK",
  tag: "Native SDK · deepest",
  blurb:
    "The richest integration — full context capture, in-process redaction, and step replay. About three lines.",
  lang: "ts",
  code: `import { withDebugger } from "@runback/sdk";
import { generateText, stepCountIs } from "ai";

const dbg = withDebugger(model, { runName: "agent", redact: "standard" });
const res = await generateText({
  model: dbg.model,
  tools: dbg.tools(myTools),
  stopWhen: stepCountIs(8),
  prompt: task,
});
await dbg.finish({ output: res.text, status: "success" });`,
};

const SDK_LANGGRAPH: Integ = {
  name: "LangGraph (Python)",
  tag: "Native SDK · deepest",
  blurb:
    "Real node identity, execution order, and state — captured via LangChain's own callback system, not a generic OpenTelemetry flatten that loses the graph's shape. Same tamper-evident digest as every other Runback SDK.",
  lang: "python",
  code: `pip install "runback-sdk[langgraph]"

from runback import RunbackCallbackHandler

handler = RunbackCallbackHandler(run_name="my-graph")
result = graph.invoke(inputs, config={"callbacks": [handler]})
handler.finish()`,
};

const OTEL: Integ[] = [
  {
    name: "OpenAI / Anthropic SDKs",
    tag: "OpenTelemetry · Python or JS",
    blurb:
      "Auto-instrument the official SDKs with OpenLLMetry — the open-source standard Traceloop maintains. No changes to your calls.",
    compareHref: "/vs/traceloop",
    compareLabel: "Already on Traceloop's hosted platform? See how it compares →",
    lang: "python",
    code: `pip install traceloop-sdk

from traceloop.sdk import Traceloop
Traceloop.init(
  api_endpoint="https://runback.dev/api/otel",
  headers={"authorization": "Bearer <RUNBACK_API_KEY>"},
)
# your openai / anthropic calls are now traced to Runback`,
  },
  {
    name: "LangChain (plain chains, no LangGraph)",
    tag: "OpenTelemetry",
    blurb:
      "Instrument with OpenInference (or OpenLLMetry) and point the OTLP exporter at Runback. Building with LangGraph specifically? Use the native SDK above — generic OTel can't preserve a graph's node identity or state, only a plain chain's.",
    lang: "bash",
    code: `pip install openinference-instrumentation-langchain \\
            opentelemetry-exporter-otlp-proto-http

# then export the env vars below, and:
#   LangChainInstrumentor().instrument()`,
  },
  {
    name: "CrewAI",
    tag: "OpenTelemetry",
    blurb: "OpenLLMetry instruments CrewAI agents, tasks, and tool calls out of the box.",
    lang: "bash",
    code: `pip install traceloop-sdk
# Traceloop.init(...) as above — CrewAI spans flow straight in.`,
  },
  {
    name: "LlamaIndex",
    tag: "OpenTelemetry",
    blurb: "Trace queries, retrievers, and LLM calls via OpenInference or OpenLLMetry.",
    lang: "bash",
    code: `pip install openinference-instrumentation-llama-index
# LlamaIndexInstrumentor().instrument(); then the env vars below.`,
  },
  {
    name: "Anything else (raw OpenTelemetry)",
    tag: "OpenTelemetry · any language",
    blurb:
      "If it emits GenAI spans, Runback reads it. Set three environment variables and go.",
    lang: "bash",
    code: OTEL_ENV,
  },
];

const MODELS = ["OpenAI", "Anthropic", "Llama", "Mistral", "Gemini", "Cohere", "Groq", "Bedrock"];

function Block({ integ }: { integ: Integ }) {
  return (
    <div className="integ">
      <div className="integ-head">
        <span className="integ-name">{integ.name}</span>
        <span className="integ-tag">{integ.tag}</span>
      </div>
      <p className="integ-blurb">{integ.blurb}</p>
      <pre className="mk-code">
        <code>{integ.code}</code>
      </pre>
      {integ.compareHref && (
        <p className="empty" style={{ marginTop: "0.6rem", fontSize: "0.86rem" }}>
          <Link href={integ.compareHref} style={{ color: "var(--brand)" }}>{integ.compareLabel}</Link>
        </p>
      )}
    </div>
  );
}

export default function Integrations() {
  return (
    <>
      <Header />
      <main className="mk" style={{ paddingTop: "3rem", paddingBottom: "4rem" }}>
        <span className="mk-eyebrow">Integrations</span>
        <h1 style={{ fontSize: "clamp(2rem,4vw,2.8rem)", letterSpacing: "-0.04em", margin: "1rem 0 0.7rem" }}>
          Runback sits above your stack.
        </h1>
        <p className="mk-lead">
          It doesn&apos;t replace LangChain, CrewAI, or the AI SDK — it governs
          whatever you built on top of them. Use the SDK for the deepest capture,
          or send traces from any framework over OpenTelemetry.
        </p>

        <IntegrationLogosFull />

        <div className="arch" style={{ marginTop: "3rem" }}>
          <div className="arch-col">
            <span className="arch-k">Your agents</span>
            <span className="arch-chip">LangGraph</span>
            <span className="arch-chip">LangChain</span>
            <span className="arch-chip">CrewAI</span>
            <span className="arch-chip">Vercel AI SDK</span>
            <span className="arch-chip">your own loop</span>
          </div>
          <div className="arch-arrow">→</div>
          <div className="arch-col">
            <span className="arch-k">One line in</span>
            <div className="arch-pipe">OpenTelemetry<br />or @runback/sdk</div>
          </div>
          <div className="arch-arrow">→</div>
          <div className="arch-runback">
            <div className="name">Runback</div>
            <div className="arch-caps">
              <span className="arch-cap">Observe</span>
              <span className="arch-cap">Replay</span>
              <span className="arch-cap">Gate</span>
              <span className="arch-cap">Audit</span>
            </div>
          </div>
        </div>

        <p className="mk-lead" style={{ marginTop: "2.4rem" }}>
          Whatever the framework, you can drill into any step:
        </p>
        <div style={{ margin: "1.2rem 0 0" }}>
          <InteractiveTrace />
        </div>

        {/* model-agnostic answer */}
        <div className="integ-models">
          <div className="im-title">
            Using a specific model? <span>Runback is model-agnostic.</span>
          </div>
          <div className="im-row">
            {MODELS.map((m) => (
              <span key={m} className="im-chip">
                {m}
              </span>
            ))}
          </div>
          <p className="im-note">
            Whatever model you call, Runback records it automatically — the
            inspector and monitoring don&apos;t care which provider you use.
            <em>Replay</em> — re-running a step against a live model —
            supports OpenAI, Anthropic, and Groq-hosted open models today;
            more are on the roadmap.
          </p>
        </div>

        <h2 className="mk-h2" style={{ marginTop: "3rem" }}>
          The deepest path
        </h2>
        <div style={{ display: "grid", gap: "1.1rem" }}>
          <Block integ={SDK} />
          <Block integ={SDK_LANGGRAPH} />
        </div>
        <p className="empty" style={{ marginTop: "0.6rem", fontSize: "0.88rem" }}>
          Not sure which of the three integration paths fits your setup?{" "}
          <Link href="/blog/three-ways-to-wire-in-runback" style={{ color: "var(--brand)" }}>
            Read the full walkthrough →
          </Link>
        </p>

        <h2 className="mk-h2" style={{ marginTop: "3rem" }}>
          Any framework, via OpenTelemetry
        </h2>
        <p className="mk-lead" style={{ marginBottom: "1.5rem" }}>
          Point your OTLP trace exporter at Runback. Every example below also
          needs these three environment variables:
        </p>
        <pre className="mk-code">
          <code>{OTEL_ENV}</code>
        </pre>
        <div style={{ display: "grid", gap: "1.1rem", marginTop: "1.5rem" }}>
          {OTEL.map((i) => (
            <Block key={i.name} integ={i} />
          ))}
        </div>

        <div className="guide-call" style={{ marginTop: "2.5rem" }}>
          <div className="k">Don&apos;t see your tool?</div>
          <p style={{ marginBottom: 0 }}>
            If it speaks OpenTelemetry GenAI conventions, it already works. Tell us
            what you use and we&apos;ll confirm the mapping —{" "}
            <Link href="/how-it-works" style={{ color: "var(--brand)" }}>
              read the guide
            </Link>{" "}
            or{" "}
            <Link href="/runs" style={{ color: "var(--brand)" }}>
              open a live run
            </Link>
            .
          </p>
        </div>

        {/* Connect out — the ecosystem */}
        <h2 className="mk-h2" style={{ marginTop: "3.5rem" }}>Then it connects out to your stack.</h2>
        <p className="mk-lead" style={{ marginBottom: "1.6rem" }}>
          Capture is half the story. Runback pushes the record into the systems your organization already runs — so it&apos;s
          governance that lives in your ecosystem, not another console to check.
        </p>
        <div className="conn-grid">
          {[
            ["Identity", "Okta · Azure AD / Entra · Google Workspace · Auth0", "SSO via OIDC, domain-routed, with provisioning.", "native"],
            ["CI / CD", "GitHub Actions · GitLab CI · Jenkins", "The eval release gate runs in your pipeline and fails the build on a regression. Agents pull versioned prompts by label over plain HTTP — no SDK required.", "native"],
            ["Incident & chat", "Slack · PagerDuty · Opsgenie · Microsoft Teams", "Alert rules route failures and error-rate spikes to email, Slack, or any webhook.", "alerts · webhooks"],
            ["Regulatory evidence", "EAAPL — AU Enterprise AI Patterns", "A scoped, read-only key exposes your live EU AI Act / ISO 42001 / NIST AI RMF / APRA CPS 230 control status to EAAPL's evidence pack. No ingest, no run content.", "read-only API"],
            ["SIEM & observability", "Splunk · Datadog · Elastic", "Stream run summaries, audit records, and ledger checkpoints out via the REST API and outbound webhooks.", "open API · webhooks"],
            ["Data warehouse", "Snowflake · BigQuery · S3", "Export signed audit records and run data to your lake for retention and analytics.", "API · export"],
            ["Your cloud", "AWS · Azure · GCP · on-prem", "Self-host the whole platform in your perimeter — your data never leaves.", "self-host"],
          ].map(([t, names, desc, tag]) => (
            <div className="conn-card" key={t}>
              <div className="conn-t">{t}<span className="conn-tag mono">{tag}</span></div>
              <div className="conn-names mono">{names}</div>
              <p>{desc}</p>
            </div>
          ))}
        </div>
        <p className="empty" style={{ marginTop: "1.4rem", fontSize: "0.88rem" }}>
          Don&apos;t see yours? Everything is reachable through the open REST API and outbound webhooks —{" "}
          <Link href="/contact" style={{ color: "var(--brand)" }}>tell us what you run</Link> and we&apos;ll confirm the wiring.
        </p>
        <p className="empty" style={{ marginTop: "0.5rem", fontSize: "0.88rem" }}>
          Need audit coverage inside an AU regulatory evidence pack?{" "}
          <Link href="/integrations/eaapl" style={{ color: "var(--brand)" }}>See the EAAPL integration →</Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
