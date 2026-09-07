-- Migration 61: itemized redaction breakdown.
-- redaction_count (migration 54) was already a total; this adds the itemized
-- breakdown by rule type (e.g. {"email": 12, "ssn": 3}) so a compliance report
-- can show WHAT was redacted, not just how many values. The SDK's redactor
-- tracks a full per-instance log (rule + JSON path) locally, but only the
-- compact rule→count summary is shipped over the wire — see
-- packages/sdk/src/collector.ts redactionByType().
ALTER TABLE ad_runs ADD COLUMN IF NOT EXISTS redaction_by_type jsonb NOT NULL DEFAULT '{}';
