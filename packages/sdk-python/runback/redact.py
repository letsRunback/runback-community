"""
Faithful port of packages/redact/src/redact.ts. Same defaults, same walk
order, same per-event-type field list — see test_redact.py for fixture
parity against the TypeScript implementation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Union

from .patterns import (
    BASE64_CANDIDATE,
    RULES,
    SENSITIVE_KEYS,
    RedactionRule,
    apply_rule,
    decode_base64_utf8,
)

RedactionTier = str  # "standard" | "strict"


@dataclass
class RedactOptions:
    # Which built-in tier to use. "standard" (default) is high-confidence only.
    preset: Optional[RedactionTier] = None
    # Replace the built-in rule set entirely.
    rules: Optional[list[RedactionRule]] = None
    # Add rules on top of the preset: (name, compiled_regex, optional replace fn).
    custom_patterns: Optional[list[tuple[str, "re.Pattern[str]", Optional[Callable[[str], str]]]]] = None
    # Extra object-key names whose values are redacted wholesale.
    redact_keys: Optional[list[str]] = None
    # Key names to never touch (takes precedence over everything).
    allow_keys: Optional[list[str]] = None
    # Full escape hatch. Return a replacement, or None to fall through to defaults.
    redactor: Optional[Callable[[Any, Optional[str]], Any]] = None
    # Called once per event with how many values were redacted.
    on_redact: Optional[Callable[[int], None]] = None
    # Max recursion depth (cycle/blowup guard).
    max_depth: int = 24


@dataclass
class RedactionLogEntry:
    rule: str
    path: Optional[str]
    ts: str


# What create_redactor() accepts: True / "standard" / "strict" / RedactOptions / False / None.
RedactorInput = Union[bool, RedactionTier, RedactOptions, None]


class Redactor:
    """Returned by create_redactor(). Mirrors the TS Redactor interface's four methods."""

    def __init__(self, opts: RedactOptions) -> None:
        self._opts = opts
        tier = opts.preset or "standard"
        base_rules = [r for r in (opts.rules or RULES) if tier == "strict" or r.tier == "standard"]
        custom_rules = [
            RedactionRule(name=name, regex=regex, tier="standard", replace=replace)
            for (name, regex, replace) in (opts.custom_patterns or [])
        ]
        self._active_rules = [*base_rules, *custom_rules]
        self._sensitive = {k.lower() for k in [*SENSITIVE_KEYS, *(opts.redact_keys or [])]}
        self._allow = {k.lower() for k in (opts.allow_keys or [])}
        self._max_depth = opts.max_depth
        self._lifetime = 0
        self._max_log = 500
        self._log: list[RedactionLogEntry] = []
        self._truncated = False

    def _record(self, rule: str, path: Optional[str]) -> None:
        if len(self._log) < self._max_log:
            self._log.append(RedactionLogEntry(rule=rule, path=path, ts=datetime.now(timezone.utc).isoformat()))
        else:
            self._truncated = True

    def _redact_string(self, s: str, counter: list[int], path: Optional[str]) -> str:
        out = s
        for rule in self._active_rules:
            out, count = apply_rule(rule, out, lambda r=rule: self._record(r.name, path))
            counter[0] += count
        return self._redact_base64_secrets(out, counter, path)

    def _redact_base64_secrets(self, s: str, counter: list[int], path: Optional[str]) -> str:
        def _sub(m: "re.Match[str]") -> str:
            candidate = m.group(0)
            decoded = decode_base64_utf8(candidate)
            if decoded is None:
                return candidate
            for rule in self._active_rules:
                _, count = apply_rule(rule, decoded)
                if count > 0:
                    counter[0] += 1
                    self._record(f"base64:{rule.name}", path)
                    return "[redacted:base64]"
            return candidate

        return BASE64_CANDIDATE.sub(_sub, s)

    def _walk(
        self,
        value: Any,
        key: Optional[str],
        depth: int,
        seen: set[int],
        counter: list[int],
        path: Optional[str],
    ) -> Any:
        if self._opts.redactor:
            r = self._opts.redactor(value, key)
            if r is not None:
                if r != value:
                    counter[0] += 1
                    self._record("custom", path)
                return r

        if key is not None:
            lk = key.lower()
            if lk in self._allow:
                return value
            if lk in self._sensitive and value is not None:
                counter[0] += 1
                self._record(f"key:{key}", path)
                return f"[redacted:key:{key}]"

        if value is None:
            return value
        if isinstance(value, str):
            return self._redact_string(value, counter, path)
        if isinstance(value, bool) or isinstance(value, (int, float)):
            return value
        if depth >= self._max_depth:
            return value

        if isinstance(value, list):
            oid = id(value)
            if oid in seen:
                return value
            seen = seen | {oid}
            return [
                self._walk(v, None, depth + 1, seen, counter, f"{path or ''}[{i}]") for i, v in enumerate(value)
            ]
        if isinstance(value, dict):
            oid = id(value)
            if oid in seen:
                return value
            seen = seen | {oid}
            return {
                k: self._walk(v, k, depth + 1, seen, counter, f"{path}.{k}" if path else k)
                for k, v in value.items()
            }
        return value

    def redact_value(self, value: Any) -> Any:
        counter = [0]
        out = self._walk(value, None, 0, set(), counter, None)
        self._lifetime += counter[0]
        return out

    def redact_event(self, event: dict) -> dict:
        """
        Redact the content-bearing fields of a trace event; envelope/metrics
        preserved. Operates on a plain dict matching the wire schema (this
        SDK has no TS-style discriminated-union type system) — same
        per-type field list as redact.ts's switch, including the "unknown
        type passes through unmodified" fallback.
        """
        counter = [0]
        seen: set[int] = set()

        def w(v: Any, k: Optional[str] = None, path: Optional[str] = None) -> Any:
            return self._walk(v, k, 0, seen, counter, path if path is not None else k)

        event_type = event.get("type")
        out = dict(event)

        if event_type == "llm":
            request = dict(event["request"])
            request["system"] = None if request.get("system") is None else w(request["system"], "system", "request.system")
            request["messages"] = w(request.get("messages"), "messages", "request.messages")
            request["tools"] = w(request.get("tools"), "tools", "request.tools")
            response = dict(event["response"])
            response["text"] = None if response.get("text") is None else w(response["text"], "text", "response.text")
            response["reasoning"] = (
                None if response.get("reasoning") is None else w(response["reasoning"], "reasoning", "response.reasoning")
            )
            response["tool_calls"] = w(response.get("tool_calls"), "tool_calls", "response.tool_calls")
            out["request"] = request
            out["response"] = response
            out["error"] = w(event["error"], "error") if event.get("error") else None
        elif event_type == "tool":
            out["input"] = w(event.get("input"), "input")
            out["output"] = None if event.get("output") is None else w(event["output"], "output")
            out["error"] = w(event["error"], "error") if event.get("error") else None
        elif event_type == "reasoning":
            out["text"] = w(event.get("text"), "text")
        elif event_type == "env":
            # Env reads are oracle entries too — a captured fetch output can
            # carry secrets/PII, so scrub it. Primitive reads (now/random/
            # uuid/date) walk to themselves, leaving the digest untouched.
            out["output"] = None if event.get("output") is None else w(event["output"], "output")
        elif event_type == "run":
            out["input"] = None if event.get("input") is None else w(event["input"], "input")
            out["output"] = None if event.get("output") is None else w(event["output"], "output")
            out["metadata"] = w(event.get("metadata"), "metadata")
            out["error"] = w(event["error"], "error") if event.get("error") else None
        # else: unknown type, returned as-is — never silently dropped.

        self._lifetime += counter[0]
        if self._opts.on_redact:
            self._opts.on_redact(counter[0])
        return out

    def total(self) -> int:
        return self._lifetime

    def log(self) -> list[RedactionLogEntry]:
        return self._log

    def log_truncated(self) -> bool:
        return self._truncated


def create_redactor(input: RedactorInput = True) -> Optional[Redactor]:
    """Accepts True/"standard"/"strict"/RedactOptions/False/None. Returns None to disable."""
    if input is False or input is None:
        return None
    if input is True:
        opts = RedactOptions()
    elif isinstance(input, str):
        opts = RedactOptions(preset=input)
    else:
        opts = input
    return Redactor(opts)
