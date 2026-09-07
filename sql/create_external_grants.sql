-- External auditor/regulator read-only grants: a THIRD scope on the existing
-- api_keys bearer-token mechanism (alongside 'ingest' and 'compliance_read'),
-- not a third auth system. Rejected alternatives (see the moat plan's ADR):
-- a signed JWT via web/lib/signing.ts (wrong tool — sign() seals records this
-- deployment controls the lifecycle of, not cheaply-revocable bearer
-- credentials; revocation would need a blocklist anyway, which is just
-- api_keys.active with extra steps); extending web/lib/trust.ts (agent-to-agent
-- only — bending its scope[]/tool-name matching to also mean "a human may
-- read run X" conflates two unrelated authorization models); generalizing
-- demoMode.ts's showcaseOrgId() (a hardcoded single-org check with no
-- expiry/scoping/revocation).
--
-- api_keys itself needs no migration — scope is a free-text column
-- (see sql/add_api_key_scope.sql), so 'external_grant' is just a new value.
CREATE TABLE IF NOT EXISTS ad_external_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  api_key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  label       text NOT NULL,                                      -- "SEC examiner, Q3 review" — shown in Settings
  scope_type  text NOT NULL CHECK (scope_type IN ('run_ids', 'control_ids', 'org_wide')),
  run_ids     text[],
  control_ids text[],
  issued_by   text NOT NULL,
  expires_at  timestamptz NOT NULL,                                -- mandatory, stricter than api_keys.expires_at elsewhere
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_external_grants_org ON ad_external_grants(org_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ad_external_grants_api_key ON ad_external_grants(api_key_id);

ALTER TABLE ad_external_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_external_grants FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "tenant_read" ON ad_external_grants FOR SELECT TO tenant USING (org_id = current_org_id());
GRANT SELECT ON ad_external_grants TO tenant;
