-- Migration 50: API key scope.
-- Existing keys are all 'ingest' (unchanged behaviour). 'compliance_read' is a
-- new, narrower scope: read-only, resolves to exactly one route
-- (/api/v1/compliance/evidence-summary), never ingest, never run content.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'ingest';

CREATE INDEX IF NOT EXISTS api_keys_scope_idx ON api_keys(scope);
