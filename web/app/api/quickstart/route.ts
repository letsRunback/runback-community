import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Serves a bash quickstart. The user runs:
 *   curl -fsSL https://runback.dev/api/quickstart | RUNBACK_API_KEY=<key> bash
 * It sends a valid sample run to the ingest endpoint and prints the link.
 *
 * The default BASE used to be hardcoded to https://runback.dev. On a
 * self-hosted deployment that silently shipped the sample run — and, more
 * importantly, whatever a customer copy-pasted this pattern for next — to
 * Runback's hosted SaaS instead of their own instance, contradicting the
 * self-host promise that no trace data leaves the customer's network (see
 * docs/SELF_HOSTING.md's Privacy posture section). Default to the origin
 * this script was actually served from; RUNBACK_INGEST_URL still overrides
 * it for anyone who wants to point elsewhere on purpose.
 */
function buildScript(origin: string, selfHosted: boolean): string {
  const runsPath = selfHosted ? "/app/runs" : "/runs";
  return `#!/usr/bin/env bash
set -e
KEY="\${RUNBACK_API_KEY:?Set RUNBACK_API_KEY to your Runback key, e.g. RUNBACK_API_KEY=rb_live_... }"
BASE="\${RUNBACK_INGEST_URL:-${origin}}"
RID="quickstart-$(date +%s)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

echo "→ Sending a sample agent run to $BASE ..."
curl -fsS -X POST "$BASE/api/ingest" \\
  -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d @- <<JSON
{ "events": [
  {"schema_version":1,"run_id":"$RID","span_id":"r","parent_span_id":null,"seq":0,"ts_start":"$TS","ts_end":null,"type":"run","phase":"start","name":"quickstart-agent","input":"hello from quickstart","output":null,"status":"running","error":null,"metadata":{"source":"quickstart"}},
  {"schema_version":1,"run_id":"$RID","span_id":"t1","parent_span_id":"r","seq":1,"ts_start":"$TS","ts_end":"$TS","type":"tool","tool_name":"echo","tool_call_id":"c1","input":{"msg":"hi"},"output":{"ok":true},"latency_ms":12,"error":null},
  {"schema_version":1,"run_id":"$RID","span_id":"re","parent_span_id":null,"seq":2,"ts_start":"$TS","ts_end":"$TS","type":"run","phase":"end","name":"quickstart-agent","input":null,"output":{"done":true},"status":"success","error":null,"metadata":{}}
] }
JSON

echo ""
echo "✓ Done. View your run:  $BASE${runsPath}/$RID"
echo "  Now point your real agent's SDK or OpenTelemetry exporter at $BASE with this key."
`;
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
  return new NextResponse(buildScript(origin, selfHosted), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
