-- Multi-tenancy + RBAC foundation.
--   orgs        — the tenant boundary
--   users       — a person (email identity)
--   memberships — user ↔ org with a role (owner > admin > member > viewer)
--   sessions    — cookie-backed login sessions
--   auth_tokens — single-use magic-link tokens
-- api_keys and ad_runs gain org_id so all data is tenant-scoped.
-- RLS service_all (the app uses the service-role key and scopes in code).

CREATE TABLE IF NOT EXISTS orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_org_id uuid REFERENCES orgs(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  org_invite uuid REFERENCES orgs(id) ON DELETE CASCADE,   -- set when this link is a team invite
  invite_role text CHECK (invite_role IN ('owner','admin','member','viewer')),
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant-scope the existing data.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE ad_runs  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES orgs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_tokens_email_idx ON auth_tokens(email);
CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys(org_id);
CREATE INDEX IF NOT EXISTS ad_runs_org_idx ON ad_runs(org_id);

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON orgs FOR ALL TO service_role USING (true);
CREATE POLICY "service_all" ON users FOR ALL TO service_role USING (true);
CREATE POLICY "service_all" ON memberships FOR ALL TO service_role USING (true);
CREATE POLICY "service_all" ON sessions FOR ALL TO service_role USING (true);
CREATE POLICY "service_all" ON auth_tokens FOR ALL TO service_role USING (true);
