"""
Mirrors packages/redact/test/adversarialInputs.test.ts. A prior audit found
the redactor only ever tested against clean, textbook secrets — these
exercise the hardening for each variant, plus prove the honestly
documented residual limits are still genuinely NOT caught.
"""

import base64
import json

from runback import create_redactor


def standard():
    return create_redactor("standard")


def strict():
    return create_redactor("strict")


def test_ssn_dashed():
    assert "123-45-6789" not in standard().redact_value("ssn 123-45-6789")


def test_ssn_dotted():
    assert "123.45.6789" not in standard().redact_value("ssn 123.45.6789")


def test_ssn_spaced():
    assert "123 45 6789" not in standard().redact_value("ssn 123 45 6789")


def test_ssn_undelimited_is_a_documented_limit_not_caught():
    out = standard().redact_value("ssn 123456789 on file")
    assert "123456789" in out  # proves the limit is real, not accidentally fixed


def test_phone_nanp():
    assert "415-555-0199" not in strict().redact_value("call 415-555-0199")


def test_phone_international_spaced_uk():
    assert "+44 20 7946 0958" not in strict().redact_value("call +44 20 7946 0958 now")


def test_phone_international_no_spaces_india():
    assert "+919876543210" not in strict().redact_value("call +919876543210 now")


def test_base64_wrapped_api_key_decoded_matched_redacted():
    key = "sk-proj-abc123def456ghi789jkl012mno345pqr"
    encoded = base64.b64encode(key.encode("utf-8")).decode("ascii")
    out = standard().redact_value(f"credential={encoded}")
    assert encoded not in out
    assert "[redacted:base64]" in out


def test_legitimate_base64_data_left_untouched():
    legit = base64.b64encode(bytes(range(1, 31))).decode("ascii")
    out = standard().redact_value(f"checksum={legit}")
    assert legit in out


def test_base64_wrapped_jwt_caught():
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.abcDEF123456"
    encoded = base64.b64encode(jwt.encode("utf-8")).decode("ascii")
    out = standard().redact_value(f"data: {encoded}")
    assert encoded not in out


def test_json_in_string_password_field_redacted():
    raw = 'response body: {"user":"jane","password":"hunter2","ok":true}'
    out = standard().redact_value(raw)
    assert "hunter2" not in out
    assert "[redacted:key:password]" in out
    assert '"user":"jane"' in out
    assert '"ok":true' in out


def test_json_in_string_multiple_sensitive_keys():
    raw = '{"api_key":"sk-abc123","secret":"topsecret","name":"ok"}'
    out = standard().redact_value(raw)
    assert "sk-abc123" not in out
    assert "topsecret" not in out
    assert '"name":"ok"' in out


def test_json_in_string_from_real_nested_object_serialization():
    payload = {"headers": {"authorization": "hunter2-token-value"}}
    raw = json.dumps(payload)
    out = standard().redact_value(raw)
    assert "hunter2-token-value" not in out
