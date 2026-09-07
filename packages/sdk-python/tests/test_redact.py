"""
Mirrors packages/redact/test/redact.test.ts fixture-for-fixture, so both
implementations are asserted against the same inputs/outputs — the
strongest available guarantee they actually match, not just "looks
equivalent."
"""

import pytest

from runback import create_redactor


def standard():
    return create_redactor("standard")


def strict():
    return create_redactor("strict")


CASES = [
    ("email", "ping me at jane.doe@acme.co please", "email"),
    ("openai_key", "key=sk-proj-abc123def456ghi789jkl012", "openai_key"),
    ("anthropic_key", "sk-ant-api03-abc123def456ghi789jkl012mno", "anthropic_key"),
    ("groq_key", "gsk_0GSAAh4qypNTnJBjcatHWGdyb3FYAbCdEf", "groq_key"),
    ("github_token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github_token"),
    ("slack_token", "xoxb-1234567890-abcdefghij", "slack_token"),
    ("google_api_key", "AIzaSyA1234567890abcdefghijklmnopqrstuv", "google_api_key"),
    ("stripe_key", "sk_live_abcdefghijklmnop1234", "stripe_key"),
    ("aws_access_key", "AKIAIOSFODNN7EXAMPLE", "aws_access_key"),
    ("ssn", "ssn 123-45-6789 on file", "ssn"),
    ("jwt", "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.abcDEF123456", "jwt"),
]


@pytest.mark.parametrize("label,input_text,tag", CASES)
def test_redacts_secret(label, input_text, tag):
    out = standard().redact_value(input_text)
    assert f"[redacted:{tag}]" in out
    secret = next((w for w in input_text.split() if len(w) > 12), "")
    if secret:
        assert secret not in out


def test_redacts_bearer_token_but_keeps_scheme():
    out = standard().redact_value("authorization: Bearer abcdef0123456789xyz")
    assert "Bearer [redacted]" in out
    assert "abcdef0123456789xyz" not in out


def test_redacts_private_key_block():
    pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBVAIBADANB\nkqhki==\n-----END RSA PRIVATE KEY-----"
    assert standard().redact_value(pem) == "[redacted:private_key]"


def test_redacts_luhn_valid_card_leaves_invalid():
    assert "[redacted:credit_card]" in standard().redact_value("card 4111 1111 1111 1111")
    assert "4111 1111 1111 1112" in standard().redact_value("order 4111 1111 1111 1112")


def test_tiers_standard_leaves_phone_and_ip_strict_redacts():
    assert "415-555-0142" in standard().redact_value("call 415-555-0142")
    assert "[redacted:phone]" in strict().redact_value("call 415-555-0142")
    assert "10.0.0.42" in standard().redact_value("host 10.0.0.42")
    assert "[redacted:ipv4]" in strict().redact_value("host 10.0.0.42")


def test_off_returns_a_noop_redactor():
    assert create_redactor(False) is None
    assert create_redactor(None) is None


def test_redacts_values_of_sensitive_keys_wholesale():
    out = standard().redact_value({"password": "hunter2", "note": "fine"})
    assert out["password"] == "[redacted:key:password]"
    assert out["note"] == "fine"


def test_walks_nested_objects_and_arrays():
    out = standard().redact_value(
        {
            "user": {"email": "a@b.com", "profile": {"ssn": "123-45-6789"}},
            "items": [{"api_key": "secret123"}, {"ok": 1}],
        }
    )
    assert "[redacted:email]" in out["user"]["email"]
    assert "[redacted:key:ssn]" in out["user"]["profile"]["ssn"]
    assert out["items"][0]["api_key"] == "[redacted:key:api_key]"
    assert out["items"][1]["ok"] == 1


def test_allow_keys_protects_a_field():
    from runback import RedactOptions

    red = create_redactor(RedactOptions(preset="standard", allow_keys=["token"]))
    out = red.redact_value({"token": "keepme", "password": "x"})
    assert out["token"] == "keepme"
    assert out["password"] == "[redacted:key:password]"


def test_survives_cycles_without_throwing():
    a = {"email": "x@y.com"}
    a["self"] = a
    standard().redact_value(a)  # must not raise / recurse infinitely


def test_applies_a_custom_pattern():
    import re

    from runback import RedactOptions

    red = create_redactor(RedactOptions(preset="standard", custom_patterns=[("emp_id", re.compile(r"EMP-\d{5}"), None)]))
    assert "[redacted:emp_id]" in red.redact_value("badge EMP-12345")


def test_custom_redactor_hook_takes_precedence():
    from runback import RedactOptions

    red = create_redactor(RedactOptions(redactor=lambda v, k: "POOF" if v == "MAGIC" else None))
    out = red.redact_value({"a": "MAGIC", "b": "n@m.com"})
    assert out["a"] == "POOF"
    assert "[redacted:email]" in out["b"]  # defaults still run elsewhere


BASE_LLM_EVENT = {
    "schema_version": 1,
    "run_id": "run1",
    "span_id": "span1",
    "parent_span_id": "root",
    "seq": 3,
    "ts_start": "2026-01-01T00:00:00.000Z",
    "ts_end": "2026-01-01T00:00:01.000Z",
    "type": "llm",
    "model": {"provider": "groq", "model_id": "gpt-oss-120b"},
    "request": {
        "system": "Email the user at admin@corp.com",
        "messages": [{"role": "user", "content": "my ssn is 123-45-6789"}],
        "tools": [],
        "params": {"temperature": 0.7},
    },
    "response": {
        "text": "sent to admin@corp.com",
        "reasoning": None,
        "finish_reason": "stop",
        "tool_calls": [],
    },
    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    "latency_ms": 1000,
    "error": None,
}


def test_redact_event_scrubs_content_but_preserves_envelope_and_metrics():
    import json

    out = standard().redact_event(BASE_LLM_EVENT)
    assert "[redacted:email]" in out["request"]["system"]
    assert "[redacted:ssn]" in json.dumps(out["request"]["messages"])
    assert "[redacted:email]" in out["response"]["text"]
    # envelope & metrics intact
    assert out["span_id"] == "span1"
    assert out["parent_span_id"] == "root"
    assert out["seq"] == 3
    assert out["model"]["model_id"] == "gpt-oss-120b"
    assert out["usage"]["total_tokens"] == 15
    assert out["latency_ms"] == 1000
    assert out["response"]["finish_reason"] == "stop"


def test_redact_event_counts_redactions_for_the_trust_log():
    red = standard()
    red.redact_event(BASE_LLM_EVENT)
    assert red.total() >= 3


def test_redact_event_redacts_env_events_instead_of_dropping_them():
    """Seam A: byte-exact capture survives redaction."""
    import json

    fetch_env = {
        "schema_version": 1,
        "run_id": "run1",
        "span_id": "envspan",
        "parent_span_id": "root",
        "seq": 7,
        "ts_start": "2026-01-01T00:00:00.000Z",
        "ts_end": None,
        "type": "env",
        "kind": "fetch",
        "key": "sha256hash",
        "output": {"status": 200, "statusText": "OK", "bodyText": "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789"},
    }
    out = standard().redact_event(fetch_env)
    assert out is not None
    assert out["type"] == "env"
    assert out["span_id"] == "envspan"
    assert out["seq"] == 7
    assert out["kind"] == "fetch"
    assert out["key"] == "sha256hash"
    assert "[redacted:github_token]" in json.dumps(out["output"])
    assert "ghp_abcdefghijklmnopqrstuvwxyz0123456789" not in json.dumps(out["output"])
    assert out["output"]["status"] == 200


def test_redact_event_leaves_a_primitive_env_read_byte_identical():
    """Digest stays stable under redaction."""
    rand_env = {
        "schema_version": 1,
        "run_id": "run1",
        "span_id": "s",
        "parent_span_id": None,
        "seq": 1,
        "ts_start": "2026-01-01T00:00:00.000Z",
        "ts_end": None,
        "type": "env",
        "kind": "random",
        "key": "random",
        "output": 0.4242,
    }
    out = standard().redact_event(rand_env)
    assert out["output"] == 0.4242
