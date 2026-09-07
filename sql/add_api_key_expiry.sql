-- Migration 49: API key expiry and last-used tracking.
-- Allows operators to issue time-bounded keys (SOC2 CC6.1 / ISO 27001 A.9.4).
-- expires_at NULL = perpetual (existing behaviour preserved).
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS api_keys_expires_at_idx ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
