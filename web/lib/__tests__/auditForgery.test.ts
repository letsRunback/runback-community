/**
 * A genuinely-signed record must not be able to display a forged outcome.
 *
 * A red-team pass showed that the signature covers only the event chain + the
 * cassette digest — NOT manifest.run_id, generated_at, or the top-level `run`
 * summary. So a real Runback-signed record could have run.status rewritten
 * error→completed with a fabricated $5M approval and still verify VALID, with
 * the forged run_id printed as blessed. The events carry the truth and ARE
 * signed, so the fix binds the summary to them: a record that misrepresents its
 * own outcome is not valid however intact the chain.
 *
 * These build a record from events (so it is internally consistent and would
 * pass every hash), then tamper ONLY the unsigned convenience fields.
 */
import { describe, it, expect } from "vitest";
import { verifyAuditRecord, buildAuditRecordFromEvents, type AuditRecord } from "@/lib/audit";
import type { TraceEvent } from "@runback/schema";
import type { RunRow } from "@/lib/runs";

function sampleEvents(): TraceEvent[] {
  return [
    { schema_version: 1, run_id: "run_real", span_id: "r", parent_span_id: null, seq: 0,
      type: "run", phase: "start", name: "agent", input: "decide", output: null, status: "running", error: null, metadata: {} },
    { schema_version: 1, run_id: "run_real", span_id: "re", parent_span_id: null, seq: 1,
      type: "run", phase: "end", name: "agent", input: null, output: { decision: "DENIED" },
      status: "error", error: { name: "PolicyBlock", message: "over limit" }, metadata: {} },
  ] as unknown as TraceEvent[];
}

const run: RunRow = {
  run_id: "run_real", name: "agent", status: "error",
  input: "decide", output: { decision: "DENIED" }, error: { name: "PolicyBlock", message: "over limit" },
  metadata: {}, step_count: 0, total_tokens: 0, started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:00:01Z",
  actor_type: null, actor_id: null,
};

describe("a signed record cannot misrepresent its own outcome", () => {
  it("verifies a consistent record (no false positive)", () => {
    const rec = buildAuditRecordFromEvents("run_real", run, sampleEvents(), "2026-01-01T00:00:02Z");
    const r = verifyAuditRecord(rec);
    expect(r.checks.consistent).toBe(true);
    // The chain, digest, cassette all pass on a genuine build.
    expect(r.checks.chain && r.checks.digest && r.checks.cassette).toBe(true);
  });

  it("rejects a forged run.status while every hash still verifies", () => {
    const rec = buildAuditRecordFromEvents("run_real", run, sampleEvents(), "2026-01-01T00:00:02Z") as AuditRecord;
    // Rewrite ONLY the unsigned summary — leave events/digests/signature intact.
    (rec.run as unknown as { status: string }).status = "completed";
    (rec.run as unknown as { output: unknown }).output = { decision: "APPROVED", amount: 5_000_000 };
    (rec.run as unknown as { error: unknown }).error = null;

    const r = verifyAuditRecord(rec);
    expect(r.checks.chain).toBe(true);       // the signed events are untouched
    expect(r.checks.consistent).toBe(false); // but the summary lies
    expect(r.valid).toBe(false);
    expect(r.verdict).toBe("invalid");
    expect(r.consistencyFailures?.join(" ")).toMatch(/run.status|run.output/);
  });

  it("rejects a forged manifest.run_id", () => {
    const rec = buildAuditRecordFromEvents("run_real", run, sampleEvents(), "2026-01-01T00:00:02Z") as AuditRecord;
    rec.manifest.run_id = "run_FORGED";
    const r = verifyAuditRecord(rec);
    expect(r.checks.consistent).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.consistencyFailures?.join(" ")).toMatch(/run_id/);
  });
});
