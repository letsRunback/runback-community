"""
Phase 2b — faithful port of packages/replay/src/cassette.ts's oracle-chain
hashing. This is what makes a run's `cassette_digest` prove something: the
same canonicalization + chaining algorithm here, in the TS SDK, and on the
server (packages/replay/src/digest.ts) must produce byte-identical digests
for the same event stream, by construction — not by convention.

RFC 8785 (JSON Canonicalization Scheme)-equivalent. Ported with the same
one deliberate divergence from a naive implementation that the TS source
documents: serialize directly from the sorted key list instead of
rebuilding a dict, because Python (like JS) preserves insertion order —
rebuilding into a fresh dict would NOT reorder integer-like keys the way
JS's own property semantics would, so this particular JS gotcha doesn't
actually apply to Python. Ported anyway, structured the same way, so the
two implementations stay visibly parallel and a future change to one is
easy to mirror in the other.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Optional


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def canonical(v: Any) -> str:
    if isinstance(v, float) and v == 0.0:
        # ECMAScript's Number::toString (what JSON.stringify uses, and what
        # RFC 8785 is defined against) serializes -0 as "0" — Python's json
        # module emits "-0.0" for a negative-zero float otherwise, which
        # would diverge from the TS implementation's digest for the same
        # value.
        return "0"
    if v is None or not isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    o: dict = v
    parts = []
    # Python has no distinct "undefined" — a key simply absent from the dict
    # never appears in `o.keys()` to begin with, which already matches
    # JSON.stringify's "omit undefined-valued keys" behavior with nothing
    # extra to check for here.
    for k in sorted(o.keys()):
        parts.append(json.dumps(k, ensure_ascii=False) + ":" + canonical(o[k]))
    return "{" + ",".join(parts) + "}"


def chain_step(prev: str, entry: dict) -> str:
    """One step of the hash chain over an entry's defining content (not its own hash)."""
    return sha256(prev + canonical({"kind": entry["kind"], "key": entry["key"], "output": entry["output"]}))


def _project_input(input_value: Any, projection: Optional[dict]) -> Any:
    if not projection:
        return input_value
    keep = projection.get("keep")
    drop = projection.get("drop")
    if not keep and not drop:
        return input_value
    if not isinstance(input_value, (dict, list)):
        return input_value
    work = json.loads(json.dumps(input_value))  # deep clone, matching the TS jsonClone
    if keep and isinstance(work, dict):
        keep_top = {k.split(".")[0] for k in keep}
        for k in list(work.keys()):
            if k not in keep_top:
                del work[k]
    if drop:
        for p in drop:
            _drop_path(work, p.split("."))
    return work


def _drop_path(node: Any, segs: list[str]) -> None:
    if node is None or not segs or not isinstance(node, (dict, list)):
        return
    if isinstance(node, list):
        for el in node:
            _drop_path(el, segs)
        return
    head, *rest = segs
    if not rest:
        node.pop(head, None)
    elif head in node:
        _drop_path(node[head], rest)


def tool_key_p(name: str, input_value: Any, projection: Optional[dict] = None) -> str:
    return sha256(f"tool:{name}:{canonical(_project_input(input_value, projection))}")


def llm_key_p(model_id: str, request: Any, projection: Optional[dict] = None) -> str:
    return sha256(f"llm:{model_id}:{canonical(_project_input(request, projection))}")


def oracle_entry_of(event: dict) -> Optional[dict]:
    """
    Map a trace event (dict, matching the wire schema) to the entry it
    contributes to the deterministic chain, or None if it isn't a
    nondeterminism boundary (run/reasoning envelopes) — the exact same rule
    packages/replay/src/cassette.ts's oracleEntryOf enforces, so a digest
    computed here and one computed server-side from the same stored events
    are identical by construction.
    """
    t = event.get("type")
    if t == "llm":
        error = event.get("error")
        return {
            "kind": "llm",
            "key": llm_key_p(event["model"]["model_id"], event["request"], event.get("key_projection")),
            "output": {"error": error} if error else event.get("response"),
        }
    if t == "tool":
        error = event.get("error")
        return {
            "kind": "tool",
            "key": tool_key_p(event["tool_name"], event.get("input"), event.get("key_projection")),
            "output": {"error": error} if error else event.get("output"),
        }
    if t == "env":
        return {"kind": event["kind"], "key": event["key"], "output": event.get("output")}
    return None
