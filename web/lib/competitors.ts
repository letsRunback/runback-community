export type Competitor = {
  name: string;
  maker: string;
  pitch: string; // what they're good at (one sentence, fair)
  gap: string; // what they don't do (one sentence)
  rows: [string, "y" | "n" | "~", "y" | "n" | "~", string][];
  // [capability, them, runback, note]
  searchTerms: string[];
  // Overrides the generic "most teams use both" closing note — for a
  // competitor whose own status (e.g. maintenance mode) makes that default
  // framing read oddly right below the row that just said so.
  closingNote?: string;
};

export const COMPETITORS: Record<string, Competitor> = {
  langsmith: {
    name: "LangSmith",
    maker: "LangChain",
    pitch: "LangSmith is an excellent trace viewer and dataset manager for LangChain apps.",
    gap: "It shows what happened. It can't re-execute the step, gate your CI pipeline, or produce a signed audit record.",
    rows: [
      ["Read and search traces", "y", "y", ""],
      ["Dataset and eval management", "y", "y", ""],
      ["Re-execute any step from captured inputs", "n", "y", "Runback's core capability — bisect in log₂ tries"],
      ["CI release gate — policy blocks the deploy", "n", "y", ""],
      ["Signed, tamper-evident audit export", "n", "y", "SHA-256 chain; verify without Runback"],
      ["Self-host, data never leaves your perimeter", "~", "y", "A full deployment exists, but it's Enterprise-tier only, license-gated, and some features (Hub, cloud-model evaluators) stay cloud-only"],
      ["Regulatory mappings (EU AI Act · CPS 230 · NIST)", "~", "y", "Publishes an EU AI Act capability crosswalk; no CPS 230 or NIST AI RMF mapping"],
      ["Redact PII/secrets automatically, on by default", "~", "y", "LangSmith's Python/TS SDKs ship a create_anonymizer() toolkit (regex, custom functions, or Presidio/Comprehend) — capable, but nothing is redacted unless you write the patterns yourself, and it isn't available in LangSmith's Go SDK. Runback's TS, Python, and Go SDKs all redact in-process with working detectors on by default"],
      ["One flat price — no separate compute/storage units", "n", "y", "LangSmith bills across four axes: seats, base traces, LangChain Compute Units ($1.50/unit), and LangChain Storage Units ($1.00/unit) — plus a paid upgrade for extended (400-day) retention. Runback is one tier: seats + runs + retention, bundled"],
      ["Purpose-built Go SDK, not just a generated REST client", "~", "y", "LangSmith's Go package is Stainless-generated REST API bindings plus a bare OpenTelemetry tracer — no traceable()-style ergonomics and no anonymizer. Runback's Go SDK has the same manual-recording shape (and redaction) as its TS/Python SDKs"],
    ],
    searchTerms: ["LangSmith alternative", "LangSmith vs Runback", "replace LangSmith"],
  },
  langfuse: {
    name: "Langfuse",
    maker: "Langfuse GmbH — acquired by ClickHouse, Jan 2026",
    pitch: "Langfuse is an open-source observability and prompt-management platform.",
    gap: "Traces are read-only — there's no re-execution, policy enforcement, or signed compliance artifact.",
    rows: [
      ["Read and search traces", "y", "y", ""],
      ["Prompt versioning and management", "y", "y", "Versioned registry with movable labels (production/staging), a runtime-fetch endpoint, and a playground"],
      ["Open-source, self-hostable", "y", "y", "Both self-hostable; Langfuse v3 now needs Postgres + ClickHouse + Redis + S3-compatible storage, not Postgres alone"],
      ["Re-execute any step from captured inputs", "n", "y", "Runback's core capability — bisect a divergence in log₂ tries"],
      ["Live policy enforcement — block before it runs", "n", "y", "Langfuse's own docs call it an ex-post assessment tool that scores external guardrail verdicts, not a live blocker"],
      ["CI release gate", "y", "y", "Shipped May 2026 (langfuse/experiment-action) — fails the PR on score regressions; evaluates a dataset, not a specific captured production run against real history the way Runback's gate does"],
      ["Signed, tamper-evident audit export", "n", "y", "Traces are stored for search and analysis, not sealed — no hash chain, no signature; a modified row and the original are indistinguishable from the database"],
      ["Regulatory mappings (EU AI Act · CPS 230 · NIST)", "n", "y", ""],
      ["Independent roadmap", "~", "y", "Acquired by ClickHouse, Jan 2026 — ClickHouse states the license, self-hosting, and roadmap are unchanged, but it's no longer a standalone company"],
      ["Redact PII/secrets before data leaves your process", "~", "y", "Langfuse's mask()/mask_otel_spans() is real, but it's a batch-level hook with no guarantee it sees a complete trace and can't touch span structure — Runback's SDK redacts each event in-process as it's captured"],
      ["No metered overage billing", "n", "y", "Langfuse bills consumption-based overage per unit (trace/observation/score) beyond the plan's included volume — Runback caps usage per tier and prompts an upgrade instead of a variable bill"],
      ["Purpose-built Go SDK", "n", "y", "Langfuse has no first-party Go SDK — Go apps go through a generic OpenTelemetry exporter only, with no Langfuse-specific ergonomics or redaction. Runback's Go SDK has the same manual-recording shape (and redaction) as its TS/Python SDKs"],
    ],
    searchTerms: ["Langfuse alternative", "Langfuse vs Runback", "replace Langfuse"],
  },
  helicone: {
    name: "Helicone",
    maker: "Helicone Inc. — acquired by Mintlify, Mar 2026",
    pitch: "Helicone is a zero-code proxy that logs every LLM call with a base-URL swap.",
    gap: "Proxy capture only sees inputs and outputs — no tool chains, no re-execution, no compliance artifacts. As of March 2026 it's also in confirmed maintenance mode following its acquisition by Mintlify: security patches and new-model support only, no new feature development.",
    rows: [
      ["Zero-code setup — base URL swap", "y", "y", "Runback also offers proxy mode"],
      ["Cost and token tracking", "y", "y", ""],
      ["Rate limiting and caching", "y", "n", "Helicone speciality — not Runback's scope"],
      ["Tool call capture (multi-step agents)", "n", "y", "Proxy only sees the outer LLM call"],
      ["Re-execute any step from captured inputs", "n", "y", "A proxy log has no captured tool state to replay against — Runback bisects a divergence in log₂ tries"],
      ["Policy simulation and enforcement", "n", "y", ""],
      ["Signed, tamper-evident audit export", "n", "y", "Proxy logs are mutable database rows — nothing seals them, so nothing here is tamper-evident by construction"],
      ["Self-host, data in your perimeter", "~", "y", "Helicone self-host is limited"],
      ["Active feature development", "n", "y", "Confirmed maintenance mode since the Mintlify acquisition, Mar 2026 — security patches and model support only"],
    ],
    searchTerms: ["Helicone alternative", "Helicone vs Runback", "replace Helicone", "Helicone Mintlify acquisition"],
    closingNote: "Helicone still works fine for logging and caching today — the concern isn't the existing feature set, it's what happens to the roadmap from here. If you're picking a platform to grow into over the next few years, that's worth weighing alongside the feature comparison above.",
  },
  braintrust: {
    name: "Braintrust",
    maker: "Braintrust Data",
    pitch: "Braintrust is an eval platform with a prompt playground and dataset management.",
    gap: "It's built for evals before deploy, not governance after — no re-execution of production incidents, no policy enforcement, no signed audit trail.",
    rows: [
      ["Eval runner and dataset management", "y", "y", ""],
      ["Prompt playground and scoring", "y", "y", "Includes pairwise (head-to-head) LLM-judge comparison with human calibration feedback"],
      ["Human review UI", "y", "n", "Braintrust speciality"],
      ["Re-execute a production incident step-by-step", "n", "y", "Braintrust replays eval DATASETS, not a specific captured production run — Runback bisects a live incident in log₂ tries"],
      ["Live policy enforcement — block before it runs", "n", "y", ""],
      ["Golden corpus auto-mined from production failures", "~", "y", "One-click promote-to-dataset plus auto-clustering of production traces — a manual promote step, not Runback's unattended mining"],
      ["Signed, tamper-evident audit export", "n", "y", "Enterprise tier has audit logs and S3 export, but nothing cryptographically signed or hash-chained"],
      ["Regulatory mappings (EU AI Act · CPS 230 · NIST)", "n", "y", ""],
    ],
    searchTerms: ["Braintrust alternative", "Braintrust Data vs Runback"],
  },
  arize: {
    name: "Arize AI",
    maker: "Arize AI",
    pitch: "Arize is a mature ML monitoring platform with drift detection and model performance tracking.",
    gap: "It's ML observability, not agent governance — no proven step-level re-execution, no pre-run policy enforcement, no regulatory compliance mappings.",
    rows: [
      ["Model performance and drift monitoring", "y", "n", "Arize speciality"],
      ["Embeddings and vector analysis", "y", "n", "Arize speciality"],
      ["LLM trace capture", "y", "y", ""],
      ["Re-execute any agent step from captured inputs", "~", "y", "2026's 'Agent Replay' can replay agent interactions for debugging — mechanism and granularity unconfirmed; no evidence of bisection or byte-exact step re-execution"],
      ["Live policy enforcement — block before it runs", "n", "y", "Arize's guardrails correct or retry a response after generation, not intercept a tool call before it runs"],
      ["CI release gate for model upgrades", "~", "y", "Markets 'evaluation gating' — block or require review on an eval regression; less proven than Runback's history-simulated gate"],
      ["Signed, tamper-evident audit export", "n", "y", "Monitoring metrics are aggregated for dashboards, not sealed as individual signed records"],
      ["Self-host, data in your perimeter", "y", "y", "Phoenix (OSS) is fully self-hostable free; Arize AX also offers on-prem enterprise deployment"],
      ["Regulatory mappings (EU AI Act · CPS 230 · NIST)", "n", "y", ""],
    ],
    searchTerms: ["Arize alternative", "Arize AI vs Runback"],
  },
  traceloop: {
    name: "Traceloop",
    maker: "Traceloop (OpenLLMetry) — acquired by ServiceNow, May 2026, folded into their AI Control Tower",
    pitch: "Traceloop maintains OpenLLMetry, the open-source OpenTelemetry standard for LLM instrumentation, plus a hosted monitoring platform on top of it.",
    gap: "It's built to get traces out of your stack via standard OTel spans — evaluation-based guardrails and CI checks now exist, but neither re-executes a captured step or produces a signed audit record.",
    rows: [
      ["Broad auto-instrumentation via OpenTelemetry", "y", "~", "Runback ingests standard GenAI OTel spans too"],
      ["Read and search traces", "y", "y", ""],
      ["Open-source instrumentation layer", "y", "~", "Runback's OTel ingestion is open; the replay/audit core is not"],
      ["Re-execute any step from captured inputs", "n", "y", "The OTel GenAI spec standardises what gets emitted, not what happens to it once stored — nothing on the receiving end re-runs a step from it"],
      ["Live policy enforcement — block before it runs", "~", "y", "Guardrails evaluators can block LLM output in real time — narrower than a tool-call-level policy engine, and evaluation-based rather than a simulated-against-history gate"],
      ["CI release gate", "~", "y", "A GitHub App runs evals on every PR and posts results — an evaluation-based check, not Runback's simulate-against-production-history gate"],
      ["Signed, tamper-evident audit export", "n", "y", "Spans reach the backend over an open wire format, but nothing seals them afterward — the standard defines transport, not chain-of-custody once stored"],
      ["Regulatory mappings (EU AI Act · CPS 230 · NIST)", "n", "y", ""],
    ],
    searchTerms: ["Traceloop alternative", "OpenLLMetry vs Runback", "Traceloop vs Runback"],
  },
  portkey: {
    name: "Portkey",
    maker: "Portkey AI",
    pitch: "Portkey is an AI gateway — unified routing across providers, with caching, fallbacks, guardrails, and observability on the request path.",
    gap: "It's built for production reliability at the request layer, not for reconstructing or re-executing what an agent decided across a multi-step run.",
    rows: [
      ["Multi-provider request routing, caching, fallbacks", "y", "n", "Portkey speciality — not Runback's scope"],
      ["Guardrails on requests/responses", "y", "~", "Runback enforces policy on tool calls, not the gateway layer"],
      ["Read and search traces", "y", "y", ""],
      ["Multi-step tool-call capture and causal links", "~", "y", "Real parent-child span tracing when the app instruments it — captures sequencing, but not enough state to replay a step"],
      ["Re-execute any step from captured inputs", "n", "y", "Without the full tool-call chain, there's no captured state to replay a specific step against"],
      ["CI release gate", "n", "y", ""],
      ["Signed, tamper-evident audit export", "n", "y", "Gateway request logs are operational telemetry — no hash chain, no signature, nothing independently verifiable"],
      ["Regulatory mappings (EU AI Act · CPS 230 · NIST)", "n", "y", ""],
    ],
    searchTerms: ["Portkey alternative", "Portkey AI vs Runback", "Portkey gateway vs Runback"],
  },
};
