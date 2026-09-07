"""
Named secret/PII detectors — a faithful port of packages/redact/src/patterns.ts.
Every rule here must match its TypeScript counterpart regex-for-regex; see
tests/test_redact.py, which mirrors packages/redact's own test fixtures so
both implementations are asserted against the same inputs/outputs.

`standard` = high-confidence (secrets + unambiguous PII). `strict` adds
noisier detectors (phone, IP) that trade precision for recall.

Honest limits, inherent to a regex-based (not parsing) redactor — same as
the TypeScript version:
- SSN: only dashed/dotted/spaced 3-2-4 grouping is caught. A fully
  undelimited 9-digit SSN is indistinguishable from any other 9-digit
  number and is deliberately NOT matched.
- Phone: NANP (3-3-4) and a leading-"+" international shape are both
  covered; an unusual grouping with neither shape can still slip through.
- Base64/JSON-in-string secrets ARE covered (see BASE64_CANDIDATE and the
  json_embedded_secret rule). What's still NOT covered: a secret encoded
  with something other than base64, or JSON-in-string using a key name
  outside SENSITIVE_KEYS.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from typing import Callable, Optional

RedactionTier = str  # "standard" | "strict"


@dataclass
class RedactionRule:
    name: str
    regex: "re.Pattern[str]"
    tier: RedactionTier
    # Return False to leave a candidate match untouched (e.g. failing checksum).
    validate: Optional[Callable[[str], bool]] = None
    # Custom replacement; defaults to "[redacted:<name>]".
    replace: Optional[Callable[[str], str]] = None


def _luhn_valid(s: str) -> bool:
    """Luhn check — keeps random 16-digit numbers from being flagged as cards."""
    d = re.sub(r"\D", "", s)
    if len(d) < 13 or len(d) > 19:
        return False
    total = 0
    alt = False
    for ch in reversed(d):
        n = ord(ch) - 48
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def _re(pattern: str, flags: int = 0) -> "re.Pattern[str]":
    return re.compile(pattern, flags)


_JSON_KEY_RE = re.compile(r'^"([^"]+)"')


def _redact_json_embedded_secret(matched: str) -> str:
    # apply_rule's replace callback only receives the full match, not capture
    # groups — re-derive the key name from the match text itself.
    m = _JSON_KEY_RE.match(matched)
    key = m.group(1) if m else "secret"
    return f'"{key}": "[redacted:key:{key}]"'


# Order matters: most specific first.
RULES: list[RedactionRule] = [
    # ── cryptographic material ──
    RedactionRule(
        name="private_key",
        tier="standard",
        regex=_re(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----"),
    ),
    # ── provider / vendor API keys ──
    RedactionRule(name="anthropic_key", tier="standard", regex=_re(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    RedactionRule(name="openai_key", tier="standard", regex=_re(r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}")),
    RedactionRule(name="groq_key", tier="standard", regex=_re(r"gsk_[A-Za-z0-9]{20,}")),
    RedactionRule(name="stripe_key", tier="standard", regex=_re(r"(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}")),
    RedactionRule(name="github_token", tier="standard", regex=_re(r"gh[posru]_[A-Za-z0-9]{36,}")),
    RedactionRule(name="slack_token", tier="standard", regex=_re(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    RedactionRule(name="google_api_key", tier="standard", regex=_re(r"AIza[0-9A-Za-z_-]{35}")),
    RedactionRule(name="aws_access_key", tier="standard", regex=_re(r"AKIA[0-9A-Z]{16}")),
    # ── tokens ──
    RedactionRule(
        name="jwt",
        tier="standard",
        regex=_re(r"eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
    ),
    RedactionRule(
        name="bearer",
        tier="standard",
        regex=_re(r"Bearer\s+[A-Za-z0-9._~+/=-]{12,}", re.IGNORECASE),
        replace=lambda _m: "Bearer [redacted]",
    ),
    # ── personal data ──
    RedactionRule(name="email", tier="standard", regex=_re(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    RedactionRule(name="ssn", tier="standard", regex=_re(r"\b\d{3}[-. ]\d{2}[-. ]\d{4}\b")),
    RedactionRule(
        name="credit_card",
        tier="standard",
        regex=_re(r"\b(?:\d[ -]?){13,19}\b"),
        validate=_luhn_valid,
    ),
    # ── secrets embedded as literal JSON-in-string text (not real object keys) ──
    RedactionRule(
        name="json_embedded_secret",
        tier="standard",
        regex=_re(
            r'"(password|passwd|pwd|secret|token|access_token|refresh_token|id_token|'
            r'api_key|apikey|authorization|client_secret|private_key)"\s*:\s*"(?:[^"\\]|\\.)*"',
            re.IGNORECASE,
        ),
        replace=_redact_json_embedded_secret,
    ),
    # ── strict-only (noisier) ──
    RedactionRule(
        name="phone",
        tier="strict",
        regex=_re(r"(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b"),
    ),
    RedactionRule(
        name="phone_intl",
        tier="strict",
        regex=_re(r"\+[1-9]\d{0,3}(?:[\s.-]?\d){7,14}\b"),
    ),
    RedactionRule(
        name="ipv4",
        tier="strict",
        regex=_re(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"),
    ),
]

# Base64-encoded secrets never match any rule above, since the encoded text
# doesn't look like the plaintext pattern. This finds base64-shaped
# substrings, decodes each candidate, and re-runs the full rule set against
# the DECODED text — if the decoded content matches something real, the
# original encoded substring is redacted wholesale.
BASE64_CANDIDATE = _re(r"(?:[A-Za-z0-9+/]{4}){10,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?")


def decode_base64_utf8(candidate: str) -> Optional[str]:
    try:
        # Node's Buffer.from(str, 'base64') tolerates missing padding; Python's
        # base64 module doesn't, so pad defensively before decoding.
        padded = candidate + "=" * (-len(candidate) % 4)
        raw = base64.b64decode(padded, validate=False)
        decoded = raw.decode("utf-8")
    except Exception:
        return None
    # Round-trip check: a non-base64 string of the right alphabet (or one
    # with incidental padding) can decode to garbage that re-encodes
    # differently. Only treat it as "real" base64 if it round-trips —
    # compared with trailing '=' stripped, matching the TS implementation.
    reencoded = base64.b64encode(decoded.encode("utf-8")).decode("ascii")
    if reencoded.rstrip("=") != candidate.rstrip("="):
        return None
    return decoded


# Object keys whose *value* should be redacted wholesale, regardless of content.
SENSITIVE_KEYS = [
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "api_key",
    "apikey",
    "authorization",
    "auth",
    "client_secret",
    "private_key",
    "ssn",
    "credit_card",
    "card_number",
    "cvv",
    "cvc",
    "pin",
]


def apply_rule(rule: RedactionRule, text: str, on_match: Optional[Callable[[], None]] = None) -> tuple[str, int]:
    count = 0

    def _replacer(m: "re.Match[str]") -> str:
        nonlocal count
        matched = m.group(0)
        if rule.validate and not rule.validate(matched):
            return matched
        count += 1
        if on_match:
            on_match()
        return rule.replace(matched) if rule.replace else f"[redacted:{rule.name}]"

    out = rule.regex.sub(_replacer, text)
    return out, count
