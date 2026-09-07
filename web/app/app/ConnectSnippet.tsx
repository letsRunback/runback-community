"use client";

import { useEffect, useRef, useState } from "react";

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="gs-cmd-box">
      <pre className="gs-cmd-pre mono">{text}</pre>
      <button
        type="button"
        className="gs-cmd-copy mono"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

const FRAMEWORKS = [
  {
    id: "node",
    label: "Node.js",
    snippet: (k: string) =>
      `// npm install @runback/sdk
import { withDebugger } from "@runback/sdk";

const dbg = withDebugger(model, {
  apiKey: "${k}",
  runName: "my-agent",
  redact: "standard",
});

const res = await generateText({ model: dbg.model, tools: dbg.tools(myTools), prompt: task });
await dbg.finish({ output: res.text, status: "success" });`,
  },
  {
    id: "curl",
    label: "cURL",
    // The wire format is a FLAT EVENT STREAM — `{ events: [...] }`, validated by
    // ingestPayloadSchema. A bare `{name, status, output}` body (what this
    // snippet used to show) fails validation with 422; it was never a working
    // example. Kept in lockstep with /api/quickstart, which sends this exact
    // shape, and asserted against the real schema by
    // web/__tests__/connectSnippets.test.ts.
    //
    // The base URL is the page's own origin, not a hardcoded runback.dev —
    // this card renders identically on the hosted SaaS and on a self-hosted
    // deployment, and self-host's entire premise is that trace data never
    // leaves the customer's network (docs/SELF_HOSTING.md's Privacy posture:
    // "No product telemetry leaves your network"). Copy-pasting a snippet
    // that posts to runback.dev from a self-hosted instance would silently
    // ship live agent data to Runback's hosted service instead.
    snippet: (k: string, base: string) =>
      `RID="hello-$(date +%s)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

curl -X POST ${base}/api/ingest \\
  -H "Authorization: Bearer ${k}" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[
    {"schema_version":1,"run_id":"'"$RID"'","span_id":"r","parent_span_id":null,"seq":0,
     "ts_start":"'"$TS"'","ts_end":null,"type":"run","phase":"start","name":"hello-agent",
     "input":"hello","output":null,"status":"running","error":null,"metadata":{}},
    {"schema_version":1,"run_id":"'"$RID"'","span_id":"re","parent_span_id":null,"seq":1,
     "ts_start":"'"$TS"'","ts_end":"'"$TS"'","type":"run","phase":"end","name":"hello-agent",
     "input":null,"output":{"done":true},"status":"success","error":null,"metadata":{}}
  ]}'

# Or let Runback build the payload for you:
#   export RUNBACK_API_KEY="${k}"
#   curl -fsSL ${base}/api/quickstart | bash`,
  },
  {
    id: "otel",
    label: "OTel",
    // Language-agnostic: any OpenTelemetry SDK works, so this is the supported
    // path for Python, Go, Java, Ruby — anything that is not Node. Exporters
    // append /v1/traces to the endpoint, which is why the route lives at
    // /api/otel/v1/traces.
    snippet: (k: string, base: string) =>
      `# Works with any OpenTelemetry SDK — Python, Go, Java, Node, …
export OTEL_EXPORTER_OTLP_ENDPOINT=${base}/api/otel
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${k}"

# then run your agent as usual, e.g.
#   opentelemetry-instrument python your_agent.py
#   node your-agent.js`,
  },
];

/**
 * The "get an API key, drop in a snippet" card — shared by the zero-run
 * Onboarding screen and the persistent /app/get-started page so both render
 * identical, non-duplicated UI.
 */
export default function ConnectSnippet({ canAdmin }: { canAdmin: boolean }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [framework, setFramework] = useState("curl");
  const autoTried = useRef(false);
  // The page's own origin — correct on both the hosted SaaS and any
  // self-hosted deployment (http://localhost:3000, https://ai.yourco.com,
  // etc.), unlike a hardcoded runback.dev. Only ever rendered post-hydration
  // (after an admin has fetched an API key), so no SSR/client mismatch risk —
  // computed directly rather than via effect + state.
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://runback.dev";

  async function getKey(auto = false) {
    setKeyLoading(true);
    const res = await fetch("/api/app/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auto }),
    });
    const data = await res.json();
    setKeyLoading(false);
    if (data.apiKey) setApiKey(data.apiKey);
    else if (!auto) alert(data.error || "Failed.");
    // auto + { exists: true } → the org already has a key. Say nothing and fall
    // through to the button; the raw value of an existing key cannot be shown
    // again, so offering to mint another is the only honest option.
  }

  // Provision the first key on arrival so the snippet below is runnable
  // immediately. The server only issues when the org has none, so this cannot
  // mint a key per page load. The ref guards React's double-invoke in dev.
  useEffect(() => {
    if (!canAdmin || autoTried.current) return;
    autoTried.current = true;
    void (async () => { await getKey(true); })();
  }, [canAdmin]);

  const fw = FRAMEWORKS.find((f) => f.id === framework) ?? FRAMEWORKS[0];

  if (!apiKey) {
    return canAdmin ? (
      <button className="btn-line" onClick={() => getKey(false)} disabled={keyLoading}>{keyLoading ? "…" : "Get an API key"}</button>
    ) : (
      <p className="empty" style={{ fontSize: "0.85rem" }}>Ask an admin for an API key.</p>
    );
  }

  return (
    <>
      <div className="onb-key mono">
        {apiKey}
        <span className="onb-key-hint">save it — shown once</span>
      </div>
      <div className="onb-fw-tabs">
        {FRAMEWORKS.map((f) => (
          <button
            key={f.id}
            className={`onb-fw-tab mono${framework === f.id ? " active" : ""}`}
            onClick={() => setFramework(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <CopyBox text={fw.snippet(apiKey, baseUrl)} />
    </>
  );
}
