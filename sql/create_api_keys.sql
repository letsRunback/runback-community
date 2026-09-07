-- Stepback API keys. Ported from the EAAPL convention:
-- SHA-256 key-hash lookup, RLS with a service-role-only policy.
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  owner_email text NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON api_keys FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash);

-- The api key's id doubles as the project/scope id for runs.
-- To create a dev key, see scripts/make-api-key.mjs (prints the raw key + the
-- INSERT to run here).
