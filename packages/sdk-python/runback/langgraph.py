"""
Native LangGraph capture. Registered via
`graph.invoke(inputs, config={"callbacks": [handler]})` — the same
mechanism LangSmith's own LangChainTracer uses. Deliberately not
OTel-based: generic OTel instrumentation of LangChain/LangGraph loses the
graph's topology entirely (verified against the standard instrumentor's
source — see the design notes this package was scoped from). LangChain's
own callback `run_id`/`parent_run_id` (real UUIDs) are used directly as
Runback `span_id`/`parent_span_id` strings — no translation table needed,
since the wire schema's span-id fields are unconstrained-format strings.

Empirically verified (langgraph 1.2.11 / langchain-core 1.6.0, a real
compiled StateGraph) rather than assumed: LangGraph's own runtime passes
`langgraph_node` / `langgraph_step` keys in `on_chain_start`'s `metadata`
dict for every node execution — a different, more direct code path than
the OTel attribute route this SDK's design notes found unreliable, since
it's LangGraph's own invocation reporting itself, not a third-party
instrumentor's interpretation.

Honest scope boundary: a conditional router IS its own chain span
(`name` = the router function's name), and its `on_chain_end` output is
the chosen next node — also empirically confirmed. This SDK captures it
as an ordinary chain-completion event like any other, not specially
parsed and attributed as "why this edge fired" — the router's rationale
(the state values that led to its decision) is visible in that event's
captured input/output, but is not a first-class `routed_from` claim
unless it can be derived with confidence. Interrupt/checkpoint (pause,
resume) is out of scope for this pass — see the plan.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from .collector import Collector, _now_iso

logger = logging.getLogger("runback")

try:
    from langchain_core.callbacks.base import BaseCallbackHandler
except ImportError as _e:  # pragma: no cover - exercised only when the optional dep is missing
    raise ImportError(
        'RunbackCallbackHandler requires langchain-core (and langgraph). Install with: '
        'pip install "runback-sdk[langgraph]"'
    ) from _e


_MAX_CAPTURE_CHARS = 4000  # bounded, same spirit as every other captured payload in this codebase


def _truncate(value: Any) -> str:
    s = value if isinstance(value, str) else repr(value)
    return s if len(s) <= _MAX_CAPTURE_CHARS else s[:_MAX_CAPTURE_CHARS] + "…"


def _bounded(value: Any) -> Any:
    """Best-effort JSON-safe, size-bounded capture of an arbitrary LangChain object."""
    try:
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        if isinstance(value, dict):
            return {k: _bounded(v) for k, v in list(value.items())[:50]}
        if isinstance(value, (list, tuple)):
            return [_bounded(v) for v in list(value)[:50]]
        # LangChain messages / arbitrary objects: capture a bounded repr rather
        # than risk a serialization error on an object this SDK doesn't know
        # the shape of — the raw text is still useful evidence, just not
        # structured. Message-shaped extraction (role/content) happens
        # separately in _serialize_messages for the actual LLM request path.
        return _truncate(value)
    except Exception:
        return "[unrepresentable]"


def _serialize_messages(messages: list[Any]) -> list[dict]:
    out = []
    for m in messages:
        role = getattr(m, "type", None) or "user"
        # LangChain's message .type values ("human", "ai", "system", "tool")
        # don't match the wire schema's role enum ("user", "assistant",
        # "system", "tool") 1:1 — map the two that differ.
        role = {"human": "user", "ai": "assistant"}.get(role, role)
        content = getattr(m, "content", None)
        out.append({"role": role, "content": content if isinstance(content, (str, list)) else _bounded(content)})
    return out


class RunbackCallbackHandler(BaseCallbackHandler):
    def __init__(self, run_name: Optional[str] = None, **collector_kwargs: Any) -> None:
        self.collector = Collector(run_name=run_name or "langgraph-run", **collector_kwargs)
        self._known_spans: set[str] = {self.collector.root_span_id}
        self._chain_start: dict[str, dict] = {}
        self._llm_start: dict[str, dict] = {}
        self._tool_start: dict[str, dict] = {}

    def finish(self, **kwargs: Any):
        return self.collector.finish(**kwargs)

    def _parent_of(self, parent_run_id: Optional[Any]) -> str:
        key = str(parent_run_id) if parent_run_id else None
        return key if key and key in self._known_spans else self.collector.root_span_id

    # ── chain callbacks (LangGraph node execution + conditional routers) ──

    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs):
        try:
            key = str(run_id)
            self._known_spans.add(key)
            meta = metadata or {}
            name = kwargs.get("name") or (serialized or {}).get("name") if serialized else None
            self._chain_start[key] = {
                "ts_start": _now_iso(),
                "parent_span_id": self._parent_of(parent_run_id),
                "name": name or "chain",
                "node_name": meta.get("langgraph_node"),
                "step": meta.get("langgraph_step"),
            }
        except Exception:
            logger.debug("[runback] on_chain_start failed", exc_info=True)

    def on_chain_end(self, outputs, *, run_id, parent_run_id=None, **kwargs):
        try:
            key = str(run_id)
            start = self._chain_start.pop(key, None) or {}
            node_name = start.get("node_name")
            # ReasoningEvent has no free-form metadata field (only LlmEvent/
            # ToolEvent do, per the schema) — fold the outcome into `text`
            # itself, matching the OTel mapper's own buildReasoning()
            # convention ("[KIND] name: summary"), rather than attaching a
            # field the wire schema would silently strip on ingest.
            self.collector.push_event(
                {
                    "span_id": key,
                    "parent_span_id": start.get("parent_span_id") or self._parent_of(parent_run_id),
                    "ts_start": start.get("ts_start") or _now_iso(),
                    "ts_end": _now_iso(),
                    "type": "reasoning",
                    "text": f"[{start.get('name', 'chain')}] {_truncate(outputs)}",
                    "label": start.get("name"),
                    **({"graph_node": {"name": node_name, **({"step": start["step"]} if start.get("step") is not None else {})}} if node_name else {}),
                }
            )
        except Exception:
            logger.debug("[runback] on_chain_end failed", exc_info=True)

    def on_chain_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        try:
            key = str(run_id)
            start = self._chain_start.pop(key, None) or {}
            self.collector.push_event(
                {
                    "span_id": key,
                    "parent_span_id": start.get("parent_span_id") or self._parent_of(parent_run_id),
                    "ts_start": start.get("ts_start") or _now_iso(),
                    "ts_end": _now_iso(),
                    "type": "reasoning",
                    "text": f"[{start.get('name', 'chain')}] error: {error}",
                    "label": "error",
                    **(
                        {"graph_node": {"name": start["node_name"]}}
                        if start.get("node_name")
                        else {}
                    ),
                }
            )
        except Exception:
            logger.debug("[runback] on_chain_error failed", exc_info=True)

    # ── LLM callbacks ──

    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs):
        self._on_llm_start_common(serialized, messages[0] if messages else [], run_id, parent_run_id, kwargs)

    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs):
        # Legacy (non-chat) LLM interface: plain prompt strings, not message objects.
        messages = [{"role": "user", "content": p} for p in (prompts or [])]
        self._on_llm_start_common(serialized, messages, run_id, parent_run_id, kwargs, already_serialized=True)

    def _on_llm_start_common(self, serialized, messages, run_id, parent_run_id, kwargs, already_serialized=False):
        try:
            key = str(run_id)
            self._known_spans.add(key)
            invocation_params = kwargs.get("invocation_params") or {}
            self._llm_start[key] = {
                "ts_start": _now_iso(),
                "parent_span_id": self._parent_of(parent_run_id),
                "provider": invocation_params.get("_type") or (serialized or {}).get("id", [None])[-1] or "unknown",
                "model_id": invocation_params.get("model") or invocation_params.get("model_name") or "unknown",
                "messages": messages if already_serialized else _serialize_messages(messages),
                "params": {
                    k: invocation_params[k]
                    for k in ("temperature", "max_tokens", "top_p")
                    if k in invocation_params
                },
            }
        except Exception:
            logger.debug("[runback] on_llm_start failed", exc_info=True)

    def on_llm_end(self, response, *, run_id, parent_run_id=None, **kwargs):
        try:
            key = str(run_id)
            start = self._llm_start.pop(key, None) or {}
            text = None
            tool_calls: list[dict] = []
            finish_reason = None
            usage = None
            try:
                gen = response.generations[0][0]
                message = getattr(gen, "message", None)
                text = getattr(message, "content", None) if message is not None else getattr(gen, "text", None)
                if not isinstance(text, str):
                    text = None
                raw_tool_calls = getattr(message, "tool_calls", None) or []
                tool_calls = [
                    {
                        "tool_call_id": tc.get("id") or "",
                        "tool_name": tc.get("name") or "",
                        "input": tc.get("args"),
                    }
                    for tc in raw_tool_calls
                ]
                finish_reason = (getattr(gen, "generation_info", None) or {}).get("finish_reason")
                usage_meta = getattr(message, "usage_metadata", None) if message is not None else None
                if usage_meta:
                    usage = {
                        "input_tokens": usage_meta.get("input_tokens", 0),
                        "output_tokens": usage_meta.get("output_tokens", 0),
                        "total_tokens": usage_meta.get("total_tokens", 0),
                    }
            except Exception:
                logger.debug("[runback] llm response parsing failed, capturing partial event", exc_info=True)

            self.collector.push_event(
                {
                    "span_id": key,
                    "parent_span_id": start.get("parent_span_id") or self._parent_of(parent_run_id),
                    "ts_start": start.get("ts_start") or _now_iso(),
                    "ts_end": _now_iso(),
                    "type": "llm",
                    "model": {"provider": start.get("provider", "unknown"), "model_id": start.get("model_id", "unknown")},
                    "request": {
                        "system": None,
                        "messages": start.get("messages", []),
                        "tools": [],
                        "params": start.get("params", {}),
                    },
                    "response": {
                        "text": text,
                        "reasoning": None,
                        "finish_reason": finish_reason,
                        "tool_calls": tool_calls,
                    },
                    "usage": usage,
                    "latency_ms": None,
                    "error": None,
                }
            )
        except Exception:
            logger.debug("[runback] on_llm_end failed", exc_info=True)

    def on_llm_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        try:
            key = str(run_id)
            start = self._llm_start.pop(key, None) or {}
            self.collector.push_event(
                {
                    "span_id": key,
                    "parent_span_id": start.get("parent_span_id") or self._parent_of(parent_run_id),
                    "ts_start": start.get("ts_start") or _now_iso(),
                    "ts_end": _now_iso(),
                    "type": "llm",
                    "model": {"provider": start.get("provider", "unknown"), "model_id": start.get("model_id", "unknown")},
                    "request": {"system": None, "messages": start.get("messages", []), "tools": [], "params": start.get("params", {})},
                    "response": {"text": None, "reasoning": None, "finish_reason": "error", "tool_calls": []},
                    "usage": None,
                    "latency_ms": None,
                    "error": {"name": type(error).__name__, "message": str(error)},
                }
            )
        except Exception:
            logger.debug("[runback] on_llm_error failed", exc_info=True)

    # ── tool callbacks ──

    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, tags=None, metadata=None, inputs=None, **kwargs):
        try:
            key = str(run_id)
            self._known_spans.add(key)
            self._tool_start[key] = {
                "ts_start": _now_iso(),
                "parent_span_id": self._parent_of(parent_run_id),
                "tool_name": (serialized or {}).get("name") or "tool",
                "input": inputs if inputs is not None else input_str,
            }
        except Exception:
            logger.debug("[runback] on_tool_start failed", exc_info=True)

    def on_tool_end(self, output, *, run_id, parent_run_id=None, **kwargs):
        try:
            key = str(run_id)
            start = self._tool_start.pop(key, None) or {}
            self.collector.push_event(
                {
                    "span_id": key,
                    "parent_span_id": start.get("parent_span_id") or self._parent_of(parent_run_id),
                    "ts_start": start.get("ts_start") or _now_iso(),
                    "ts_end": _now_iso(),
                    "type": "tool",
                    "tool_name": start.get("tool_name", "tool"),
                    "tool_call_id": key,
                    "input": _bounded(start.get("input")),
                    "output": _bounded(getattr(output, "content", output)),
                    "latency_ms": None,
                    "error": None,
                }
            )
        except Exception:
            logger.debug("[runback] on_tool_end failed", exc_info=True)

    def on_tool_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        try:
            key = str(run_id)
            start = self._tool_start.pop(key, None) or {}
            self.collector.push_event(
                {
                    "span_id": key,
                    "parent_span_id": start.get("parent_span_id") or self._parent_of(parent_run_id),
                    "ts_start": start.get("ts_start") or _now_iso(),
                    "ts_end": _now_iso(),
                    "type": "tool",
                    "tool_name": start.get("tool_name", "tool"),
                    "tool_call_id": key,
                    "input": _bounded(start.get("input")),
                    "output": None,
                    "latency_ms": None,
                    "error": {"name": type(error).__name__, "message": str(error)},
                }
            )
        except Exception:
            logger.debug("[runback] on_tool_error failed", exc_info=True)
