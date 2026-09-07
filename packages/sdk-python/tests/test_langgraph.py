"""
A real, small, cyclic-capable LangGraph graph (one conditional edge) run
through RunbackCallbackHandler — not mocked LangGraph internals, the
actual library, so a LangGraph API change that breaks this SDK's
assumptions about callback metadata shape fails here first.
"""

from typing import TypedDict

import pytest
import responses
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from langgraph.graph import END, StateGraph

from runback import RunbackCallbackHandler


class GraphState(TypedDict):
    count: int


def _build_graph():
    def node_a(state: GraphState) -> dict:
        return {"count": state["count"] + 1}

    def node_b(state: GraphState) -> dict:
        return {"count": state["count"] + 10}

    def router(state: GraphState) -> str:
        return "b" if state["count"] < 5 else END

    g = StateGraph(GraphState)
    g.add_node("a", node_a)
    g.add_node("b", node_b)
    g.set_entry_point("a")
    g.add_conditional_edges("a", router, {"b": "b", END: END})
    g.add_edge("b", END)
    return g.compile()


def test_captures_node_identity_via_langgraph_node_metadata():
    handler = RunbackCallbackHandler(run_name="t", api_key="k", ingest_url="http://x")
    result = _build_graph().invoke({"count": 0}, config={"callbacks": [handler]})
    assert result == {"count": 11}

    reasoning = [e for e in handler.collector._buffer if e["type"] == "reasoning"]
    node_names = {e["graph_node"]["name"] for e in reasoning if e.get("graph_node")}
    assert node_names == {"a", "b"}

    # step ordering preserved
    a_events = [e for e in reasoning if e.get("graph_node", {}).get("name") == "a"]
    assert a_events[0]["graph_node"]["step"] == 1
    b_events = [e for e in reasoning if e.get("graph_node", {}).get("name") == "b"]
    assert b_events[0]["graph_node"]["step"] == 2


def test_node_execution_parents_correctly_under_the_graph_root():
    handler = RunbackCallbackHandler(run_name="t", api_key="k", ingest_url="http://x")
    _build_graph().invoke({"count": 0}, config={"callbacks": [handler]})
    events = handler.collector._buffer
    run_start = next(e for e in events if e["type"] == "run" and e["phase"] == "start")
    # every top-level chain span (the graph invocation itself and each node)
    # eventually traces back to the collector's own run root, not floating
    # disconnected — proves LangChain's run_id/parent_run_id chaining landed
    # correctly on Runback's span_id/parent_span_id.
    span_ids = {e["span_id"] for e in events}
    for e in events:
        if e["type"] == "run":
            continue
        assert e["parent_span_id"] in span_ids or e["parent_span_id"] == run_start["span_id"]


def test_llm_call_captured_with_request_and_response():
    handler = RunbackCallbackHandler(run_name="t", api_key="k", ingest_url="http://x")
    model = FakeListChatModel(responses=["hello there"])
    model.invoke([HumanMessage(content="hi")], config={"callbacks": [handler]})

    llm_events = [e for e in handler.collector._buffer if e["type"] == "llm"]
    assert len(llm_events) == 1
    assert llm_events[0]["request"]["messages"] == [{"role": "user", "content": "hi"}]
    assert llm_events[0]["response"]["text"] == "hello there"


def test_tool_call_captured_with_input_and_output():
    @tool
    def search(query: str) -> str:
        """Search for something."""
        return f"results for {query}"

    handler = RunbackCallbackHandler(run_name="t", api_key="k", ingest_url="http://x")
    result = search.invoke({"query": "weather"}, config={"callbacks": [handler]})
    assert result == "results for weather"

    tool_events = [e for e in handler.collector._buffer if e["type"] == "tool"]
    assert len(tool_events) == 1
    assert tool_events[0]["tool_name"] == "search"
    assert tool_events[0]["output"] == "results for weather"


@responses.activate
def test_finish_flushes_the_whole_captured_graph_run():
    responses.add(responses.POST, "http://x/api/ingest", json={"ok": True, "ingested": 5}, status=200)
    handler = RunbackCallbackHandler(run_name="t", api_key="k", ingest_url="http://x")
    _build_graph().invoke({"count": 0}, config={"callbacks": [handler]})
    result = handler.finish(status="success")
    assert result.ok is True
    assert handler.collector._buffer == []


def test_import_error_without_langchain_core_has_a_clear_install_hint(monkeypatch):
    """
    Simulates the optional-dependency path: importing runback.langgraph
    without langchain-core installed must fail with install instructions,
    not a bare ModuleNotFoundError.
    """
    import builtins
    import importlib
    import sys

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "langchain_core.callbacks.base":
            raise ImportError("No module named 'langchain_core'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    sys.modules.pop("runback.langgraph", None)
    with pytest.raises(ImportError, match="runback-sdk\\[langgraph\\]"):
        importlib.import_module("runback.langgraph")
    sys.modules.pop("runback.langgraph", None)
