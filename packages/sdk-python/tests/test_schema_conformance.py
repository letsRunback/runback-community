"""
Validates real Python-SDK-constructed payloads against
packages/schema/schema.json — the JSON Schema exported from
packages/schema/src/validate.ts's zod validator, the actual source of
truth for what /api/ingest accepts. A TS schema change that isn't
mirrored in this Python port fails HERE, not silently in production.

Regenerate schema.json with: npm run export-json-schema --workspace @runback/schema
"""

import json
from pathlib import Path

import jsonschema
import pytest
import responses
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool as lc_tool
from langgraph.graph import END, StateGraph
from typing import TypedDict

from runback import Collector, RunbackCallbackHandler

SCHEMA_PATH = Path(__file__).parent.parent.parent / "schema" / "schema.json"


@pytest.fixture(scope="module")
def ingest_schema():
    if not SCHEMA_PATH.exists():
        pytest.skip(f"{SCHEMA_PATH} not generated — run: npm run export-json-schema --workspace @runback/schema")
    return json.loads(SCHEMA_PATH.read_text())


def _captured_payload(collector: Collector) -> dict:
    return {"events": collector._buffer}


def test_a_plain_collector_run_conforms(ingest_schema):
    c = Collector(run_name="conformance-test", api_key="k")
    c.record_llm(
        model={"provider": "test", "model_id": "m"},
        request={"system": "be helpful", "messages": [{"role": "user", "content": "hi"}], "tools": [], "params": {}},
        response={"text": "hello", "reasoning": None, "finish_reason": "stop", "tool_calls": []},
        usage={"input_tokens": 5, "output_tokens": 2, "total_tokens": 7},
    )
    c.record_tool(tool_name="search", tool_call_id="t1", input={"q": "x"}, output={"r": []})
    c.record_reasoning("thought about it", label="chain", graph_node={"name": "triage", "step": 1}, routed_from=["intake"])
    jsonschema.validate(instance=_captured_payload(c), schema=ingest_schema)


@responses.activate
def test_a_finished_collector_run_conforms(ingest_schema):
    responses.add(responses.POST, "http://x/api/ingest", json={"ok": True, "ingested": 1}, status=200)
    c = Collector(run_name="conformance-test", api_key="k", ingest_url="http://x")
    c.record_tool(tool_name="search", tool_call_id="t1", input={"q": "x"}, output=None, error=RuntimeError("boom"))
    c.finish(status="error", error=RuntimeError("outer failure"))
    # finish() flushes immediately — validate what was actually POSTed, not
    # the (now-empty) buffer.
    sent_body = json.loads(responses.calls[-1].request.body)
    jsonschema.validate(instance=sent_body, schema=ingest_schema)


def test_a_real_langgraph_run_conforms(ingest_schema):
    class GraphState(TypedDict):
        count: int

    def node_a(state: GraphState) -> dict:
        return {"count": state["count"] + 1}

    g = StateGraph(GraphState)
    g.add_node("a", node_a)
    g.set_entry_point("a")
    g.add_edge("a", END)
    compiled = g.compile()

    handler = RunbackCallbackHandler(run_name="conformance-langgraph", api_key="k")
    compiled.invoke({"count": 0}, config={"callbacks": [handler]})
    jsonschema.validate(instance=_captured_payload(handler.collector), schema=ingest_schema)


def test_a_real_llm_call_conforms(ingest_schema):
    handler = RunbackCallbackHandler(run_name="conformance-llm", api_key="k")
    model = FakeListChatModel(responses=["hi"])
    model.invoke([HumanMessage(content="hello")], config={"callbacks": [handler]})
    jsonschema.validate(instance=_captured_payload(handler.collector), schema=ingest_schema)


def test_a_real_tool_call_conforms(ingest_schema):
    @lc_tool
    def search(query: str) -> str:
        """Search for something."""
        return f"results for {query}"

    handler = RunbackCallbackHandler(run_name="conformance-tool", api_key="k")
    search.invoke({"query": "weather"}, config={"callbacks": [handler]})
    jsonschema.validate(instance=_captured_payload(handler.collector), schema=ingest_schema)
