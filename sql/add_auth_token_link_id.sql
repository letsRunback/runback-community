-- Opaque URL reference for magic-link tokens.
-- The raw auth secret (token_hash) is no longer placed in URLs;
-- link_id is the opaque value emailed to the user (prevents Referer/log leakage).
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS link_id text;
CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_link_id_idx ON auth_tokens(link_id) WHERE link_id IS NOT NULL;
