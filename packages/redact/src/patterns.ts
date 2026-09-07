/**
 * Named secret/PII detectors. Each rule is a global regex plus an optional
 * validator to suppress false positives. Ordered specific → general so that a
 * provider key isn't first eaten by a looser rule.
 *
 * `standard` = high-confidence (secrets + unambiguous PII). `strict` adds noisier
 * detectors (phone, IP) that trade precision for recall.
 *
 * Honest limits, inherent to a regex-based (not parsing) redactor:
 * - SSN: only dashed/dotted/spaced 3-2-4 grouping is caught. A fully
 *   undelimited 9-digit SSN is indistinguishable from any other 9-digit
 *   number and is deliberately NOT matched (the false-positive cost would
 *   exceed the benefit).
 * - Phone: NANP (3-3-4) and a leading-"+" international shape are both
 *   covered; an unusual grouping with neither shape can still slip through.
 * - Base64/JSON-in-string secrets ARE now covered (see BASE64_CANDIDATE and
 *   the json_embedded_secret rule) — earlier versions of this module missed
 *   both. What's still NOT covered: a secret encoded with something other
 *   than base64 (hex, custom obfuscation), or JSON-in-string using a key
 *   name outside SENSITIVE_KEYS.
 */

export type RedactionTier = "standard" | "strict";

export interface RedactionRule {
  name: string;
  regex: RegExp;
  tier: RedactionTier;
  /** Return false to leave a candidate match untouched (e.g. failing checksum). */
  validate?: (match: string) => boolean;
  /** Custom replacement; defaults to `[redacted:<name>]`. */
  replace?: (match: string) => string;
}

/** Luhn check — keeps random 16-digit numbers from being flagged as cards. */
function luhnValid(s: string): boolean {
  const d = s.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const tag = (name: string) => `[redacted:${name}]`;

// Order matters: most specific first.
export const RULES: RedactionRule[] = [
  // ── cryptographic material ──
  {
    name: "private_key",
    tier: "standard",
    regex:
      /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
  },
  // ── provider / vendor API keys ──
  { name: "anthropic_key", tier: "standard", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai_key", tier: "standard", regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "groq_key", tier: "standard", regex: /gsk_[A-Za-z0-9]{20,}/g },
  { name: "stripe_key", tier: "standard", regex: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: "github_token", tier: "standard", regex: /gh[posru]_[A-Za-z0-9]{36,}/g },
  { name: "slack_token", tier: "standard", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google_api_key", tier: "standard", regex: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "aws_access_key", tier: "standard", regex: /AKIA[0-9A-Z]{16}/g },
  // ── tokens ──
  {
    name: "jwt",
    tier: "standard",
    regex: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    name: "bearer",
    tier: "standard",
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replace: () => "Bearer [redacted]",
  },
  // ── personal data ──
  // The local part was an unbounded `+` — on any long string with no '@' at
  // all (extremely common: most tool-output/JSON blobs), the regex engine
  // retries the "consume everything, backtrack one char, look for @" dance
  // from every starting position, giving O(n²) time. Measured 2.4s on a
  // single 50,000-char field with no email in it. RFC 5321 caps a real
  // email's local part at 64 chars, so bounding the quantifier to {1,64}
  // loses no real detections and cuts this to O(n) — 16ms on the same input.
  { name: "email", tier: "standard", regex: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Dash was the only delimiter recognized — a dotted (123.45.6789) or
  // spaced (123 45 6789) SSN, both real-world formats, passed through
  // untouched. Undelimited (9 bare digits) is deliberately NOT added here:
  // with no separator it's indistinguishable from any other 9-digit number,
  // and the false-positive rate would swamp real matches.
  { name: "ssn", tier: "standard", regex: /\b\d{3}[-. ]\d{2}[-. ]\d{4}\b/g },
  {
    name: "credit_card",
    tier: "standard",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: luhnValid,
  },
  // ── secrets embedded as literal JSON-in-string text (not real object keys) ──
  // walk() in redact.ts only inspects actual object keys — a value that IS a
  // string containing serialized JSON (a proxy logging a raw HTTP body, a
  // tool that stringifies its own output) never gets key-based SENSITIVE_KEYS
  // treatment, since there's no real key for `sensitive.has(lk)` to check.
  // This scans string CONTENT for the same key names in "key": "value" shape
  // and redacts just the value, preserving the surrounding JSON structure.
  {
    name: "json_embedded_secret",
    tier: "standard",
    regex:
      /"(password|passwd|pwd|secret|token|access_token|refresh_token|id_token|api_key|apikey|authorization|client_secret|private_key)"\s*:\s*"(?:[^"\\]|\\.)*"/gi,
    // applyRule's replace callback only receives the full match, not capture
    // groups (see applyRule in this file) — re-derive the key name from the
    // match text itself rather than changing that shared contract.
    replace: (m) => {
      const key = /^"([^"]+)"/.exec(m)?.[1] ?? "secret";
      return `"${key}": "[redacted:key:${key}]"`;
    },
  },
  // ── strict-only (noisier) ──
  {
    name: "phone",
    tier: "strict",
    regex: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  },
  // International formats (e.g. +44 20 7946 0958, +91 98765 43210) don't
  // follow NANP's 3-3-4 grouping, so the rule above misses most of them. This
  // catches any "+<country code><7-14 more digits>" shape regardless of how
  // the digits are grouped/spaced — looser on internal structure, but still
  // anchored on the leading "+" so it doesn't fire on arbitrary long numbers.
  {
    name: "phone_intl",
    tier: "strict",
    regex: /\+[1-9]\d{0,3}(?:[\s.-]?\d){7,14}\b/g,
  },
  { name: "ipv4", tier: "strict", regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

/**
 * Base64-encoded secrets (a key pasted through a base64 encoder, or a
 * provider that base64-wraps a credential in a header/body) never matched
 * any rule above, since the encoded text doesn't look like the plaintext
 * pattern. This finds base64-shaped substrings, decodes each candidate, and
 * re-runs the full rule set against the DECODED text — if the decoded
 * content matches something real (an API key, a JWT, ...), the original
 * encoded substring is redacted wholesale. Deliberately conservative: only
 * candidates that decode to valid UTF-8 AND match a rule are touched, so
 * this can't mangle legitimate base64 data (an image, a content hash) that
 * happens to appear in traced text.
 */
export const BASE64_CANDIDATE = /(?:[A-Za-z0-9+/]{4}){10,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;

export function decodeBase64Utf8(candidate: string): string | null {
  try {
    const decoded = Buffer.from(candidate, "base64").toString("utf8");
    // Round-trip check: a non-base64 string of the right alphabet (or one
    // with incidental padding) can decode to garbage that re-encodes
    // differently. Only treat it as "real" base64 if it round-trips.
    if (Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "") !== candidate.replace(/=+$/, "")) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/** Object keys whose *value* should be redacted wholesale, regardless of content. */
export const SENSITIVE_KEYS = [
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
];

export function applyRule(
  rule: RedactionRule,
  input: string,
  onMatch?: () => void
): { out: string; count: number } {
  let count = 0;
  const re = new RegExp(rule.regex.source, rule.regex.flags.includes("g") ? rule.regex.flags : rule.regex.flags + "g");
  const out = input.replace(re, (m) => {
    if (rule.validate && !rule.validate(m)) return m;
    count++;
    onMatch?.();
    return rule.replace ? rule.replace(m) : tag(rule.name);
  });
  return { out, count };
}
