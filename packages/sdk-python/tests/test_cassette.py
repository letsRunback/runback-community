"""
Cross-language digest parity: expected values below were computed by
running the ACTUAL TypeScript implementation
(packages/replay/src/cassette.ts) against these exact fixtures via
`npx tsx`, not derived from this Python port. Byte-identical output here
is the strongest available guarantee — a real digest computed by this SDK
and one computed server-side (or by any other Runback SDK) from the same
event stream must match, by construction, or the entire tamper-evidence
claim is void. Regenerate the expected values by re-running the same tsx
snippet against cassette.ts if this file's fixtures ever change.
"""

from runback.cassette import canonical, chain_step, oracle_entry_of, sha256


def test_canonical_matches_the_ts_implementation_byte_for_byte():
    cases = [
        (None, "null"),
        (42, "42"),
        (-0.0, "0"),  # ECMAScript Number::toString serializes -0 as "0"
        ("hello", '"hello"'),
        (True, "true"),
        ([1, 2, 3], "[1,2,3]"),
        ({"b": 2, "a": 1}, '{"a":1,"b":2}'),  # keys sorted
        ({"z": [1, {"y": 2, "x": 1}], "a": "text"}, '{"a":"text","z":[1,{"x":1,"y":2}]}'),
        # Integer-like keys must NOT be reordered to the front the way a
        # naive "rebuild into a fresh object" implementation would under
        # JS's own property semantics — this is the one deliberate
        # divergence-from-naive the TS source calls out explicitly.
        ({"0": "zero", "1": "one", "42": "forty-two", "name": "test"}, '{"0":"zero","1":"one","42":"forty-two","name":"test"}'),
    ]
    for value, expected in cases:
        assert canonical(value) == expected


def test_chain_step_matches_the_ts_implementation():
    entry = {"kind": "tool", "key": "abc123", "output": {"r": "sunny"}}
    assert chain_step("", entry) == EXPECTED_CHAIN_STEP


def test_oracle_entry_of_and_end_to_end_digest_match_the_ts_implementation():
    tool_event = {
        "type": "tool",
        "tool_name": "search",
        "tool_call_id": "t1",
        "input": {"q": "weather"},
        "output": {"r": "sunny"},
        "error": None,
    }
    entry = oracle_entry_of(tool_event)
    assert entry == {
        "kind": "tool",
        "key": "0e1e5077577570a01a273425a2525981dc95efe76418ad7a1655ad82f0f1cb68",
        "output": {"r": "sunny"},
    }
    assert chain_step("", entry) == EXPECTED_TOOL_DIGEST


def test_empty_chain_falls_back_to_sha256_empty_string():
    assert sha256("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


# Exact digests from `npx tsx` against the real TS cassette.ts, pinned here
# rather than inline so a future fixture change is a visible, deliberate diff.
EXPECTED_CHAIN_STEP = "6969a239efd67dc20ff09e8f14f1f2e2fd6d4e5f4221b39dd2402a074e94611f"
EXPECTED_TOOL_DIGEST = "4ee1d9b4991d89ed800555cf2ba7ee764cb73058ee97741f1c3c4d4fddeacce2"
