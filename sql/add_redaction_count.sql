-- Migration 54: redaction count per run.
-- Self-reported by the SDK (packages/sdk/src/collector.ts) at run-end — the
-- server never sees the raw value that was redacted, so it can't
-- independently verify a redaction happened; this is the same trust
-- boundary as every other client-supplied field on the run-end event.
-- Lets the compliance report (web/lib/compliance.ts) report a real,
-- queried "redactions applied" figure instead of an unbacked UI claim.
ALTER TABLE ad_runs
  ADD COLUMN IF NOT EXISTS redaction_count integer NOT NULL DEFAULT 0;
