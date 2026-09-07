/**
 * A verifier that says VALID to a record nobody produced is not a verifier.
 *
 * The chain algorithm is published on /spec and shipped in @runback/verify so
 * that anyone can check a record without trusting us. The unavoidable
 * consequence is that anyone can also *author* a record that satisfies it, or
 * take a real one, edit a tool output, and re-chain it. Every integrity check
 * then passes, because integrity is exactly the property that was rebuilt.
 *
 * So integrity cannot be the pass condition. Only a signature verified against
 * a key obtained OUT OF BAND — the key pinned in this deployment, not the one
 * travelling inside the record — shows the record came from the agent it names.
 *
 * These tests pin that distinction. The record built by `rechained()` below is
 * a forgery that satisfies every hash in the format; if `valid` is ever true
 * for it, the product's central claim is false.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { verifyAuditRecord, AUDIT_SCHEMA, type AuditRecord } from "@/lib/audit";
import { cassetteDigestFromEvents } from "@runback/replay";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    return Object.keys(v as object).sort().reduce((acc: Record<string, unknown>, k) => {
      acc[k] = sortKeys((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
  }
  return v;
}
const canonical = (v: unknown) => JSON.stringify(sortKeys(v) ?? null);

/**
 * Build a record whose chain, digest and cassette digest are all internally
 * perfect — i.e. what an attacker produces after editing a real record and
 * re-running the published algorithm.
 */
function rechained(overrides: Partial<AuditRecord> = {}): AuditRecord {
  const events = [
    { schema_version: 1, run_id: "forged", span_id: "a", seq: 0, type: "run", phase: "start", name: "agent", input: "hello", output: null, status: "running" },
    { schema_version: 1, run_id: "forged", span_id: "b", seq: 1, type: "run", phase: "end", name: "agent", input: null, output: { refunded: 999999 }, status: "success" },
  ] as unknown as AuditRecord["events"];

  let prev = "";
  const hashed = events.map((e) => {
    const copy = { ...e } as Record<string, unknown>;
    delete copy._hash;
    prev = sha256(prev + canonical(copy));
    return { ...e, _hash: prev };
  });

  return {
    $schema: AUDIT_SCHEMA,
    manifest: {
      run_id: "forged",
      content_digest: prev,
      // Derived with the real function, not guessed: the whole premise is that
      // an attacker runs the published algorithm and gets a perfect record.
      replay: { cassette_digest: cassetteDigestFromEvents(events).digest },
    },
    events: hashed,
    ...overrides,
  } as unknown as AuditRecord;
}

describe("a self-consistent record is not a verified one", () => {
  it("does not report valid for a record that is merely internally consistent", () => {
    const r = verifyAuditRecord(rechained());
    // Integrity is genuinely intact — that is the point of the attack.
    expect(r.checks.chain).toBe(true);
    expect(r.checks.digest).toBe(true);
    // ...and it must still not pass.
    expect(r.valid).toBe(false);
    expect(r.verdict).toBe("unverified");
  });

  it("reports unsigned records as unverified, never as valid", () => {
    const r = verifyAuditRecord(rechained());
    expect(r.checks.signature).toBe("unsigned");
    expect(r.valid).toBe(false);
  });

  it("separates 'unverified' from 'invalid' so the two are actionable", () => {
    // Nothing was altered — we simply cannot say who wrote it.
    expect(verifyAuditRecord(rechained()).verdict).toBe("unverified");

    // Something WAS altered: break the chain by editing an event post-hash.
    const tampered = rechained();
    (tampered.events[1] as unknown as Record<string, unknown>).output = { refunded: 1 };
    expect(verifyAuditRecord(tampered).verdict).toBe("invalid");
  });

  it("rejects a file that never claimed to be a Runback record", () => {
    // QA found a fabricated record with $schema "not-runback/v99" passing every
    // check and exiting 0 — hashed and graded against rules it never claimed.
    const alien = rechained({ $schema: "not-runback/v99" } as unknown as Partial<AuditRecord>);
    const r = verifyAuditRecord(alien);
    expect(r.checks.schema).toBe(false);
    expect(r.verdict).toBe("invalid");
    expect(r.valid).toBe(false);
  });

  it("keeps integrity observable even when the record does not pass", () => {
    // Downgrading the verdict must not hide WHY. A caller has to be able to
    // distinguish "altered" from "unattributed" without re-implementing this.
    const r = verifyAuditRecord(rechained());
    expect(r.integrity).toBe(true);
    expect(r.valid).toBe(false);
  });
});
