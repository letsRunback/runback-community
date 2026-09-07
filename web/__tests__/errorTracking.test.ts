/**
 * Two things must be right or error tracking is worse than nothing.
 *
 * GROUPING. Fingerprints too strict and every request produces a "new" error —
 * a firehose nobody reads, which is indistinguishable from having no tracking.
 * Too loose and unrelated faults merge, so a real outage hides inside a group
 * that already looks known and triaged.
 *
 * SCRUBBING. Error messages routinely carry whatever was being processed: a
 * bearer token from a failed fetch, a connection string, an API key. Storing
 * errors is only safe if storing them cannot itself become the leak — and
 * unlike a log line, these rows are queried, exported to a SIEM, and kept.
 */
import { describe, it, expect } from "vitest";
import { normaliseMessage, scrub, fingerprintOf } from "@/lib/errorTracking";

describe("fingerprint grouping", () => {
  it("groups the same fault across different ids", () => {
    const a = fingerprintOf("Error", "run 01KYVX1R0SB0PNQQKWQFNNP3N3 not found", "/api/runs/[run_id]");
    const b = fingerprintOf("Error", "run 01ABCD2R0SB0PNQQKWQFNNP9Z9 not found", "/api/runs/[run_id]");
    expect(a).toBe(b);
  });

  it("groups across UUIDs and numbers", () => {
    const a = fingerprintOf("Error", "org 63f54b0b-289c-4ec0-b762-3de5f2e3ca3a exceeded 500 runs", "/api/x");
    const b = fingerprintOf("Error", "org 97a1c898-9906-412d-a558-e0762db7f369 exceeded 12000 runs", "/api/x");
    expect(a).toBe(b);
  });

  it("separates different faults on the same route", () => {
    const a = fingerprintOf("TypeError", "x is not a function", "/api/x");
    const b = fingerprintOf("RangeError", "index out of bounds", "/api/x");
    expect(a).not.toBe(b);
  });

  it("separates the same message on different routes", () => {
    const a = fingerprintOf("Error", "not found", "/api/runs");
    const b = fingerprintOf("Error", "not found", "/api/policies");
    expect(a).not.toBe(b);
  });

  it("normalises quoted values, keys and hashes", () => {
    expect(normaliseMessage('column "agent" does not exist')).toBe("column <value> does not exist");
    expect(normaliseMessage("invalid key rb_live_abc123def456")).toBe("invalid key <key>");
    expect(normaliseMessage("digest a3f5b2c9d8e1f0a3b2c9d8e1f0a3b2c9 mismatch")).toBe("digest <hash> mismatch");
  });
});

describe("secret scrubbing", () => {
  it("removes API keys of every prefix the product issues", () => {
    for (const k of ["rb_live_abc123", "rb_test_abc123", "rb_comp_abc123", "rb_scim_abc123"]) {
      expect(scrub(`request failed with key ${k}`), k).not.toContain(k);
    }
  });

  it("removes provider keys and JWTs", () => {
    expect(scrub("openai rejected sk-proj-AbCdEf0123456789")).not.toContain("AbCdEf0123456789");
    expect(scrub("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdef")).toContain("<redacted-jwt>");
  });

  it("removes database credentials from a connection string", () => {
    const scrubbed = scrub("connect failed: postgresql://admin:s3cr3tpw@db.internal:5432/runback");
    expect(scrubbed).not.toContain("s3cr3tpw");
    expect(scrubbed).toContain("<redacted>@");
  });

  it("removes header-style secrets", () => {
    expect(scrub('authorization: "Bearer abc123xyz"')).not.toContain("abc123xyz");
    expect(scrub("password=hunter2")).not.toContain("hunter2");
  });

  it("leaves an ordinary message intact so the error stays readable", () => {
    const msg = "Could not compute the compliance summary: relation does not exist";
    expect(scrub(msg)).toBe(msg);
  });
});
