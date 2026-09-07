/**
 * AUDIT_ED25519_PRIVATE_KEY rotation.
 *
 * A signed audit record is something a customer downloads and files as
 * evidence — it can outlive whatever key signed it by months. The HMAC
 * ledger-checkpoint key already has a ring (auditKeyRotation.test.ts,
 * AUDIT_SIGNING_KEY_PREVIOUS in lib/ledgerCore.ts); the Ed25519 audit-record
 * key didn't, until now. These tests pin the same asymmetry: sign with the
 * newest key, verify against every key we've plausibly signed with.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import { buildAuditRecordFromEvents, verifyAuditRecord } from "@/lib/audit";
import type { RunRow } from "@/lib/runs";
import type { TraceEvent } from "@runback/schema";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

const RUN: RunRow = {
  run_id: "r1", name: "rotation-test", status: "success",
  input: null, output: null, error: null, metadata: {},
  step_count: 1, total_tokens: 0, started_at: "t", ended_at: "t",
  actor_type: null, actor_id: null,
};
const EVENTS = [
  { schema_version: 1, run_id: "r1", span_id: "s1", parent_span_id: null, seq: 0, type: "run", phase: "start", name: "rotation-test" },
] as unknown as TraceEvent[];

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
beforeEach(() => {
  delete process.env.AUDIT_ED25519_PRIVATE_KEY;
  delete process.env.AUDIT_ED25519_PUBLIC_KEY;
  delete process.env.AUDIT_ED25519_PRIVATE_KEY_PREVIOUS;
  delete process.env.AUDIT_ED25519_PUBLIC_KEY_PREVIOUS;
  delete process.env.AUDIT_SIGNING_KEY;
});

describe("audit Ed25519 key ring", () => {
  it("still verifies as valid a record signed BEFORE the rotation", () => {
    const oldKey = keypair();
    const newKey = keypair();

    // Signed while OLD was the only configured key…
    process.env.AUDIT_ED25519_PRIVATE_KEY = oldKey.privatePem;
    const record = buildAuditRecordFromEvents("r1", RUN, EVENTS, "t");
    expect(record.manifest.signature?.alg).toBe("Ed25519");

    // …then the key rotates, old value retained as the previous key.
    process.env.AUDIT_ED25519_PRIVATE_KEY = newKey.privatePem;
    process.env.AUDIT_ED25519_PRIVATE_KEY_PREVIOUS = oldKey.privatePem;

    const res = verifyAuditRecord(record);
    expect(res.checks.signature).toBe("valid");
    expect(res.valid).toBe(true);
  });

  it("verifies as valid a record signed AFTER the rotation", () => {
    const oldKey = keypair();
    const newKey = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = newKey.privatePem;
    process.env.AUDIT_ED25519_PRIVATE_KEY_PREVIOUS = oldKey.privatePem;

    const record = buildAuditRecordFromEvents("r1", RUN, EVENTS, "t");
    const res = verifyAuditRecord(record);
    expect(res.checks.signature).toBe("valid");
    expect(res.valid).toBe(true);
  });

  it("would have downgraded the pre-rotation record to valid-unpinned without the ring", () => {
    // The regression this ring exists to prevent, asserted directly so it
    // doesn't silently regress back to a single pinned key.
    const oldKey = keypair();
    const newKey = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = oldKey.privatePem;
    const record = buildAuditRecordFromEvents("r1", RUN, EVENTS, "t");

    process.env.AUDIT_ED25519_PRIVATE_KEY = newKey.privatePem;
    delete process.env.AUDIT_ED25519_PRIVATE_KEY_PREVIOUS; // no ring

    const res = verifyAuditRecord(record);
    expect(res.checks.signature).toBe("valid-unpinned");
    expect(res.valid).toBe(false);
  });

  it("still reports valid-unpinned, never valid, for a signer that was never ours", () => {
    const attacker = keypair();
    const ours = keypair();
    process.env.AUDIT_ED25519_PRIVATE_KEY = attacker.privatePem;
    const record = buildAuditRecordFromEvents("r1", RUN, EVENTS, "t");

    process.env.AUDIT_ED25519_PRIVATE_KEY = ours.privatePem;
    const res = verifyAuditRecord(record);
    expect(res.checks.signature).toBe("valid-unpinned");
    expect(res.valid).toBe(false);
  });
});
