import { describe, it, expect } from "vitest";
import { createRedactor } from "../src/index";

const r = () => createRedactor("standard")!;
const strict = () => createRedactor("strict")!;

/**
 * A prior audit found the redactor only ever tested against clean, textbook
 * secrets — undelimited/dotted SSNs, non-US phone numbers, base64-encoded
 * secrets, and JSON-in-string secrets all passed through untouched. These
 * tests exercise the hardening added for each, plus prove the honestly
 * documented residual limits (fully undelimited SSN, non-base64 encodings)
 * are still genuinely NOT caught — so a future change can't silently regress
 * one into the other without a test noticing either way.
 */

describe("SSN variants", () => {
  it("dashed (existing coverage — must still work)", () => {
    expect(r().redactValue("ssn 123-45-6789") as string).not.toContain("123-45-6789");
  });
  it("dotted", () => {
    expect(r().redactValue("ssn 123.45.6789") as string).not.toContain("123.45.6789");
  });
  it("spaced", () => {
    expect(r().redactValue("ssn 123 45 6789") as string).not.toContain("123 45 6789");
  });
  it("DOCUMENTED LIMIT: fully undelimited SSN is NOT caught (indistinguishable from any 9-digit number)", () => {
    const out = r().redactValue("ssn 123456789 on file") as string;
    expect(out).toContain("123456789"); // proves the limit is real, not accidentally fixed
  });
});

describe("phone number variants", () => {
  it("NANP (existing coverage — must still work)", () => {
    const out = strict().redactValue("call 415-555-0199") as string;
    expect(out).not.toContain("415-555-0199");
  });
  it("international, spaced grouping (UK)", () => {
    const out = strict().redactValue("call +44 20 7946 0958 now") as string;
    expect(out).not.toContain("+44 20 7946 0958");
  });
  it("international, no spaces (India)", () => {
    const out = strict().redactValue("call +919876543210 now") as string;
    expect(out).not.toContain("+919876543210");
  });
});

describe("base64-encoded secrets", () => {
  it("a base64-wrapped API key is decoded, matched, and redacted", () => {
    const key = "sk-proj-abc123def456ghi789jkl012mno345pqr";
    const encoded = Buffer.from(key, "utf8").toString("base64");
    const out = r().redactValue(`credential=${encoded}`) as string;
    expect(out).not.toContain(encoded);
    expect(out).toContain("[redacted:base64]");
  });

  it("legitimate base64 data that decodes to non-matching bytes is left untouched", () => {
    // A content hash / small binary blob, base64-encoded — decodes to bytes
    // that don't match any rule, so it must survive unchanged.
    const legit = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]).toString("base64");
    const out = r().redactValue(`checksum=${legit}`) as string;
    expect(out).toContain(legit);
  });

  it("a base64-wrapped JWT is caught the same way", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.abcDEF123456";
    const encoded = Buffer.from(jwt, "utf8").toString("base64");
    const out = r().redactValue(`data: ${encoded}`) as string;
    expect(out).not.toContain(encoded);
  });
});

describe("secrets embedded in JSON-in-string content (not real object keys)", () => {
  it("a stringified JSON blob with a password field is redacted even though it's not a real object key", () => {
    // walk() only inspects real object keys — this is a STRING value that
    // happens to contain JSON text, e.g. a proxy logging a raw HTTP body.
    const raw = 'response body: {"user":"jane","password":"hunter2","ok":true}';
    const out = r().redactValue(raw) as string;
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[redacted:key:password]");
    // structure is preserved — the rest of the JSON text survives.
    expect(out).toContain('"user":"jane"');
    expect(out).toContain('"ok":true');
  });

  it("catches multiple sensitive keys in the same embedded blob", () => {
    const raw = '{"api_key":"sk-abc123","secret":"topsecret","name":"ok"}';
    const out = r().redactValue(raw) as string;
    expect(out).not.toContain("sk-abc123");
    expect(out).not.toContain("topsecret");
    expect(out).toContain('"name":"ok"');
  });

  it("this ALSO fires on a real nested object's stringified serialization, not just hand-written text", () => {
    const payload = { headers: { authorization: "hunter2-token-value" } };
    const raw = JSON.stringify(payload); // simulates a tool that stringifies its own output
    const out = r().redactValue(raw) as string;
    expect(out).not.toContain("hunter2-token-value");
  });
});
