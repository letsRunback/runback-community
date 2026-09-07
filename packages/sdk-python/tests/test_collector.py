"""
Mirrors packages/sdk/src/collector.ts's push/flush/finish behavior:
buffering, redaction-before-buffering, auto-flush at threshold, requeue on
failure (network or non-2xx), and never raising into the caller.
"""

import json

import responses

from runback import Collector


def test_constructor_pushes_a_run_start_envelope():
    c = Collector(run_name="t", api_key="k")
    assert len(c._buffer) == 1
    assert c._buffer[0]["type"] == "run"
    assert c._buffer[0]["phase"] == "start"
    assert c._buffer[0]["name"] == "t"
    assert c._buffer[0]["parent_span_id"] is None


def test_record_llm_and_tool_build_events_with_expected_shape():
    c = Collector(run_name="t", api_key="k")
    span_id = c.record_llm(
        model={"provider": "groq", "model_id": "m"},
        request={"system": None, "messages": [], "tools": [], "params": {}},
        response={"text": "hi", "reasoning": None, "finish_reason": "stop", "tool_calls": []},
    )
    assert span_id
    llm_event = c._buffer[-1]
    assert llm_event["type"] == "llm"
    assert llm_event["parent_span_id"] == c._root_span_id
    assert llm_event["seq"] == 1

    c.record_tool(tool_name="search", tool_call_id="tc1", input={"q": "x"}, output={"r": []})
    tool_event = c._buffer[-1]
    assert tool_event["type"] == "tool"
    assert tool_event["parent_span_id"] == span_id  # links back to the LLM step that requested it
    assert tool_event["tool_name"] == "search"


def test_record_reasoning_carries_graph_node_and_routed_from():
    c = Collector(run_name="t", api_key="k")
    c.record_reasoning("did a thing", label="chain", graph_node={"name": "triage"}, routed_from=["intake"])
    event = c._buffer[-1]
    assert event["type"] == "reasoning"
    assert event["graph_node"] == {"name": "triage"}
    assert event["routed_from"] == ["intake"]


def test_redaction_runs_before_buffering():
    c = Collector(run_name="t", api_key="k", redact=True)
    c.record_tool(tool_name="lookup", tool_call_id="t1", input={"api_key": "sk-ant-abcdefghijklmnopqrstuvwx"}, output=None)
    event = c._buffer[-1]
    assert event["input"]["api_key"] == "[redacted:key:api_key]"


def test_auto_flushes_once_the_buffer_reaches_flush_at():
    with responses.RequestsMock() as rsps:
        rsps.add(responses.POST, "http://x/api/ingest", json={"ok": True, "ingested": 3}, status=200)
        c = Collector(run_name="t", api_key="k", ingest_url="http://x", flush_at=3)
        # constructor already pushed 1 (run/start); two more tool events reach flush_at=3.
        c.record_tool(tool_name="a", tool_call_id="1", input=None, output=None)
        c.record_tool(tool_name="b", tool_call_id="2", input=None, output=None)
        assert c._buffer == []  # flushed automatically
        assert len(rsps.calls) == 1


@responses.activate
def test_flush_posts_the_expected_request_shape():
    responses.add(responses.POST, "http://x/api/ingest", json={"ok": True, "ingested": 1}, status=200)
    c = Collector(run_name="t", api_key="my-key", ingest_url="http://x")
    result = c.flush()
    assert result.ok is True
    assert result.sent == 1
    req = responses.calls[0].request
    assert req.headers["authorization"] == "Bearer my-key"
    assert req.headers["content-type"] == "application/json"
    body = json.loads(req.body)
    assert len(body["events"]) == 1


@responses.activate
def test_flush_requeues_the_batch_on_non_2xx():
    responses.add(responses.POST, "http://x/api/ingest", json={"error": "nope"}, status=500)
    c = Collector(run_name="t", api_key="k", ingest_url="http://x")
    result = c.flush()
    assert result.ok is False
    assert result.sent == 0
    assert len(c._buffer) == 1  # requeued, not dropped


def test_flush_with_no_api_key_drops_and_reports_error():
    c = Collector(run_name="t", api_key=None, ingest_url="http://x")
    result = c.flush()
    assert result.ok is False
    assert result.sent == 0
    assert c._buffer == []  # dropped, not requeued — matches TS: no key means no retry will ever work


def test_flush_on_network_error_requeues_and_never_raises():
    # No responses mock registered — requests raises ConnectionError, which
    # flush() must catch, not propagate into the caller's graph execution.
    c = Collector(run_name="t", api_key="k", ingest_url="http://127.0.0.1:1")
    result = c.flush()
    assert result.ok is False
    assert len(c._buffer) == 1


@responses.activate
def test_finish_pushes_run_end_flushes_and_returns_run_id():
    responses.add(responses.POST, "http://x/api/ingest", json={"ok": True, "ingested": 2}, status=200)
    c = Collector(run_name="t", api_key="k", ingest_url="http://x")
    result = c.finish(output={"done": True}, status="success")
    assert result.ok is True
    assert result.run_id == c.run_id
    assert result.ingest_url == "http://x"
    body = json.loads(responses.calls[0].request.body)
    end_event = next(e for e in body["events"] if e["type"] == "run" and e["phase"] == "end")
    assert end_event["status"] == "success"
    assert end_event["output"] == {"done": True}
    # Phase 2b: a run with zero oracle entries (no llm/tool/env events —
    # this test only pushes the run start/end envelopes) falls back to
    # sha256(""), matching the TS collector's exact fallback.
    import hashlib

    assert end_event["metadata"]["cassette_digest"] == hashlib.sha256(b"").hexdigest()
    assert end_event["metadata"]["cassette_entries"] == 0


@responses.activate
def test_finish_computes_a_real_cassette_digest_matching_the_ported_algorithm():
    """
    Cross-checks the collector's chained digest against an independently
    hand-computed expectation using runback.cassette's own primitives — the
    strongest available guarantee the wiring in Collector._push is correct,
    not just "some string came out."
    """
    from runback.cassette import chain_step, oracle_entry_of, sha256

    responses.add(responses.POST, "http://x/api/ingest", json={"ok": True, "ingested": 3}, status=200)
    c = Collector(run_name="t", api_key="k", ingest_url="http://x")
    c.record_tool(tool_name="search", tool_call_id="t1", input={"q": "weather"}, output={"r": "sunny"})
    result = c.finish(status="success")
    assert result.ok is True

    body = json.loads(responses.calls[0].request.body)
    tool_event = next(e for e in body["events"] if e["type"] == "tool")
    end_event = next(e for e in body["events"] if e["type"] == "run" and e["phase"] == "end")

    expected_entry = oracle_entry_of(tool_event)
    expected_digest = chain_step("", expected_entry)
    assert end_event["metadata"]["cassette_digest"] == expected_digest
    assert end_event["metadata"]["cassette_entries"] == 1
    assert expected_digest != sha256("")  # sanity: a real chain, not the empty fallback


@responses.activate
def test_finish_reports_redaction_count_in_metadata():
    responses.add(responses.POST, "http://x/api/ingest", json={"ok": True, "ingested": 2}, status=200)
    c = Collector(run_name="t", api_key="k", ingest_url="http://x")
    c.record_tool(tool_name="lookup", tool_call_id="t1", input={"password": "hunter2"}, output=None)
    result = c.finish(status="success")
    assert result.ok is True
    body = json.loads(responses.calls[0].request.body)
    end_event = next(e for e in body["events"] if e["type"] == "run" and e["phase"] == "end")
    assert end_event["metadata"]["redaction_count"] >= 1
