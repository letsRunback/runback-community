"""
Faithful port of packages/sdk/src/collector.ts's capture/buffer/flush
lifecycle. The wire schema is already snake_case, so Python's natural
style already matches the JSON on the wire — no camelCase translation
layer needed.

Phase 2b: advances the same oracle hash chain (cassette.py, ported from
packages/replay/src/cassette.ts) TS's Collector does, so a run captured by
this SDK gets a real `cassette_digest` — identical, by construction, to
what the server would compute from the same stored events — instead of
the Phase 2a fallback (no digest at all).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import requests
from ulid import ULID

from .cassette import chain_step, oracle_entry_of, sha256
from .redact import Redactor, RedactorInput, create_redactor

logger = logging.getLogger("runback")


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _to_trace_error(err: Any) -> Optional[dict]:
    if err is None:
        return None
    if isinstance(err, BaseException):
        return {"name": type(err).__name__, "message": str(err)}
    if isinstance(err, dict):
        return err
    return {"name": "Error", "message": str(err)}


@dataclass
class FlushResult:
    ok: bool
    sent: int
    error: Optional[str]


@dataclass
class FinishResult(FlushResult):
    run_id: str = ""
    ingest_url: str = ""


@dataclass
class Actor:
    type: str  # "user" | "api_key" | "system"
    id: str
    label: Optional[str] = None


class Collector:
    """
    Owns one run's identity and buffers trace events, flushing them to the
    ingest endpoint. Every public method is internally guarded — instrumentation
    must never raise into the caller's agent/graph execution.
    """

    SCHEMA_VERSION = 1

    def __init__(
        self,
        run_name: str,
        input: Any = None,
        tags: Optional[dict] = None,
        actor: Optional[Actor] = None,
        ingest_url: Optional[str] = None,
        api_key: Optional[str] = None,
        flush_at: int = 25,
        redact: RedactorInput = True,
    ) -> None:
        self.run_id = str(ULID())
        self.run_name = run_name
        self._root_span_id = str(ULID())
        self._seq = 0
        self._buffer: list[dict] = []
        self._last_llm_span_id: Optional[str] = None
        self._actor = actor
        self._flush_at = flush_at
        self.redactor: Optional[Redactor] = create_redactor(redact)
        # Running oracle-stream chain — the deterministic cassette digest at
        # capture time (Phase 2b). Matches TS's cassettePrev/cassetteCount.
        self._cassette_prev = ""
        self._cassette_count = 0

        explicit_url = ingest_url or os.environ.get("RUNBACK_INGEST_URL")
        self.ingest_url = (explicit_url or "http://localhost:3000").rstrip("/")
        self.api_key = api_key or os.environ.get("RUNBACK_API_KEY")

        if not explicit_url and self.api_key and self.api_key.startswith("rb_live_"):
            logger.warning(
                "[runback] RUNBACK_INGEST_URL is not set, so events will be sent to "
                "http://localhost:3000 — but your API key is a hosted key. Set "
                "RUNBACK_INGEST_URL=https://runback.dev (or your self-host origin), "
                "or nothing will be recorded."
            )

        self._push(
            {
                "schema_version": self.SCHEMA_VERSION,
                "run_id": self.run_id,
                "span_id": self._root_span_id,
                "parent_span_id": None,
                "seq": self._next(),
                "ts_start": _now_iso(),
                "ts_end": None,
                "type": "run",
                "phase": "start",
                "name": run_name,
                "input": input,
                "output": None,
                "status": "running",
                "error": None,
                "metadata": tags or {},
            }
        )

    def _next(self) -> int:
        seq = self._seq
        self._seq += 1
        return seq

    def _stamp_actor(self, event: dict) -> dict:
        if self._actor and "actor" not in event:
            event = {**event, "actor": {"type": self._actor.type, "id": self._actor.id, **({"label": self._actor.label} if self._actor.label else {})}}
        return event

    def _push(self, event: dict) -> None:
        try:
            event = self._stamp_actor(event)
            if self.redactor:
                try:
                    event = self.redactor.redact_event(event)
                except Exception:
                    return  # never buffer an event that failed to redact
            self._buffer.append(event)
            # Redaction runs BEFORE chaining (above), so the recorded and
            # replayed values stay identical and the digest is computed
            # over the scrubbed value — matching the TS collector exactly.
            entry = oracle_entry_of(event)
            if entry is not None:
                self._cassette_prev = chain_step(self._cassette_prev, entry)
                self._cassette_count += 1
            if len(self._buffer) >= self._flush_at:
                self.flush()
        except Exception:
            pass  # never raise into the caller's graph execution

    @property
    def root_span_id(self) -> str:
        return self._root_span_id

    def push_event(self, event: dict) -> None:
        """
        Low-level escape hatch: push a fully-formed event dict through the
        same pipeline (actor stamping, redaction, buffering, auto-flush) as
        every other record_* method. `schema_version`/`run_id` are filled in
        if absent. For a caller (the LangGraph handler) that needs explicit
        control over span_id/parent_span_id to mirror an external call
        graph — LangChain's own run_id/parent_run_id — rather than the
        simple "last LLM span" parent heuristic record_llm/record_tool use,
        which assumes a linear single-agent flow.
        """
        event.setdefault("schema_version", self.SCHEMA_VERSION)
        event.setdefault("run_id", self.run_id)
        event.setdefault("seq", self._next())
        self._push(event)

    def record_llm(
        self,
        model: dict,
        request: dict,
        response: dict,
        usage: Optional[dict] = None,
        latency_ms: Optional[int] = None,
        error: Any = None,
        key_projection: Optional[dict] = None,
        metadata: Optional[dict] = None,
    ) -> str:
        """Record a completed (or failed) LLM call. Returns the new span_id."""
        span_id = str(ULID())
        event = {
            "schema_version": self.SCHEMA_VERSION,
            "run_id": self.run_id,
            "span_id": span_id,
            "parent_span_id": self._root_span_id,
            "seq": self._next(),
            "ts_start": _now_iso(),
            "ts_end": _now_iso(),
            "type": "llm",
            "model": model,
            "request": request,
            "response": response,
            "usage": usage,
            "latency_ms": latency_ms,
            "error": _to_trace_error(error),
            **({"key_projection": key_projection} if key_projection else {}),
            **({"metadata": metadata} if metadata else {}),
        }
        self._last_llm_span_id = span_id
        self._push(event)
        return span_id

    def record_tool(
        self,
        tool_name: str,
        tool_call_id: str,
        input: Any,
        output: Any,
        latency_ms: Optional[int] = None,
        error: Any = None,
        ts_start: Optional[str] = None,
        policy_evaluated: bool = False,
        key_projection: Optional[dict] = None,
        metadata: Optional[dict] = None,
        actor: Optional[Actor] = None,
    ) -> None:
        """Record a tool execution (success or error)."""
        event = {
            "schema_version": self.SCHEMA_VERSION,
            "run_id": self.run_id,
            "span_id": str(ULID()),
            "parent_span_id": self._last_llm_span_id,
            "seq": self._next(),
            "ts_start": ts_start or _now_iso(),
            "ts_end": _now_iso(),
            "type": "tool",
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "input": input,
            "output": output,
            "latency_ms": latency_ms,
            "error": _to_trace_error(error),
            **({"actor": {"type": actor.type, "id": actor.id}} if actor else {}),
            **({"key_projection": key_projection} if key_projection else {}),
            **({"policy_evaluated": {"passed": True}} if policy_evaluated else {}),
            **({"metadata": metadata} if metadata else {}),
        }
        self._push(event)

    def record_reasoning(
        self,
        text: str,
        label: Optional[str] = None,
        graph_node: Optional[dict] = None,
        routed_from: Optional[list[str]] = None,
    ) -> None:
        """Record a reasoning/log marker — used by the LangGraph handler for node-execution steps."""
        event = {
            "schema_version": self.SCHEMA_VERSION,
            "run_id": self.run_id,
            "span_id": str(ULID()),
            "parent_span_id": self._last_llm_span_id or self._root_span_id,
            "seq": self._next(),
            "ts_start": _now_iso(),
            "ts_end": _now_iso(),
            "type": "reasoning",
            "text": text,
            "label": label,
            **({"graph_node": graph_node} if graph_node else {}),
            **({"routed_from": routed_from} if routed_from else {}),
        }
        self._push(event)

    def flush(self) -> FlushResult:
        """POST whatever is buffered. Clears the buffer on success; requeues on failure."""
        if not self._buffer:
            return FlushResult(ok=True, sent=0, error=None)
        batch, self._buffer = self._buffer, []

        if not self.api_key:
            logger.warning("[runback] no RUNBACK_API_KEY set — dropped %d events", len(batch))
            return FlushResult(ok=False, sent=0, error="no RUNBACK_API_KEY set")

        try:
            res = requests.post(
                f"{self.ingest_url}/api/ingest",
                json={"events": batch},
                headers={"content-type": "application/json", "authorization": f"Bearer {self.api_key}"},
                timeout=30,
            )
        except Exception as e:
            error = f"ingest error contacting {self.ingest_url}: {e}"
            logger.warning("[runback] %s", error)
            self._buffer = batch + self._buffer
            return FlushResult(ok=False, sent=0, error=error)

        if not res.ok:
            error = f"ingest failed {res.status_code} {res.text}"
            logger.warning("[runback] %s", error)
            self._buffer = batch + self._buffer
            return FlushResult(ok=False, sent=0, error=error)

        return FlushResult(ok=True, sent=len(batch), error=None)

    def finish(self, output: Any = None, status: Optional[str] = None, error: Any = None) -> FinishResult:
        metadata: dict = {
            "cassette_digest": self._cassette_prev or sha256(""),
            "cassette_entries": self._cassette_count,
            "redaction_count": self.redactor.total() if self.redactor else 0,
        }
        if self.redactor:
            by_type: dict[str, int] = {}
            for entry in self.redactor.log():
                by_type[entry.rule] = by_type.get(entry.rule, 0) + 1
            metadata["redaction_by_type"] = by_type

        self._push(
            {
                "schema_version": self.SCHEMA_VERSION,
                "run_id": self.run_id,
                "span_id": str(ULID()),
                "parent_span_id": self._root_span_id,
                "seq": self._next(),
                "ts_start": _now_iso(),
                "ts_end": _now_iso(),
                "type": "run",
                "phase": "end",
                "name": self.run_name,
                "input": None,
                "output": output,
                "status": status or ("error" if error else "success"),
                "error": _to_trace_error(error),
                "metadata": metadata,
            }
        )
        flushed = self.flush()
        if self.redactor and self.redactor.total() > 0:
            logger.info("[runback] redacted %d sensitive value(s) before sending", self.redactor.total())
        return FinishResult(ok=flushed.ok, sent=flushed.sent, error=flushed.error, run_id=self.run_id, ingest_url=self.ingest_url)
