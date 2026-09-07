-- Enterprise SSO (OIDC). Per-org IdP config; email domains route logins to it.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_issuer text;          -- OIDC issuer URL
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_client_id text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_client_secret text;   -- encrypted at rest (AES-256-GCM via SSO_SECRET_KEY)
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_domains text[] NOT NULL DEFAULT '{}';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_default_role text NOT NULL DEFAULT 'member'
  CHECK (sso_default_role IN ('owner','admin','member','viewer'));

-- Fast lookup of "which org owns this email domain for SSO".
CREATE INDEX IF NOT EXISTS orgs_sso_domains_idx ON orgs USING gin (sso_domains);
