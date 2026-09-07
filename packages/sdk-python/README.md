# runback-sdk (Python)

Native LangGraph capture for [Runback](https://runback.dev) — the AI-agent audit/observability platform. Captures graph node execution, state, and tool/LLM calls via LangChain's own callback system (the same mechanism LangSmith's tracer uses), not a generic OpenTelemetry flatten — see the design notes for why that distinction matters for anything graph-shaped rather than tree-shaped.

## Install

```bash
pip install "runback-sdk[langgraph]"
```

## Use

```python
from runback import RunbackCallbackHandler

handler = RunbackCallbackHandler(run_name="my-graph")
result = graph.invoke(inputs, config={"callbacks": [handler]})
handler.finish()
```

Configure via `RUNBACK_API_KEY` / `RUNBACK_INGEST_URL` environment variables, or pass `api_key=`/`ingest_url=` explicitly.

## Status

Captured runs are stored, replayable via the LLM/tool oracle, viewable in the product, and carry a real `cassette_digest` — the same oracle-chain hashing algorithm as the TypeScript SDK and the server, so a digest computed here matches one computed from the same stored events server-side, by construction. Routing rationale for conditional edges (*why* an edge fired, not just which node ran) is a known, documented gap — see the LangGraph capture design notes. Checkpoint/interrupt (pause, resume) support is not implemented.

Redaction (standard tier) is **on by default** — matching the TypeScript SDK's posture.
