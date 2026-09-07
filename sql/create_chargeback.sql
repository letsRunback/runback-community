-- Teams: named sub-units within an org for cost attribution
CREATE TABLE IF NOT EXISTS ad_teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  budget_usd numeric(10,2),  -- monthly cap, null = unlimited
  color      text,           -- hex color for UI
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX IF NOT EXISTS ad_teams_org ON ad_teams(org_id);
ALTER TABLE ad_teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON ad_teams;
CREATE POLICY service_all ON ad_teams FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Tag runs to teams
ALTER TABLE ad_runs ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES ad_teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ad_runs_team ON ad_runs(team_id) WHERE team_id IS NOT NULL;

-- Agent-to-team prefix rules (e.g. agents starting with "loan-" → Lending team)
CREATE TABLE IF NOT EXISTS ad_team_agent_rules (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id   uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  team_id  uuid NOT NULL REFERENCES ad_teams(id) ON DELETE CASCADE,
  prefix   text NOT NULL,   -- agent name prefix, case-insensitive
  UNIQUE (org_id, prefix)
);
ALTER TABLE ad_team_agent_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON ad_team_agent_rules;
CREATE POLICY service_all ON ad_team_agent_rules FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Daily chargeback rollup per team
CREATE TABLE IF NOT EXISTS ad_chargeback (
  org_id   uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  team_id  uuid NOT NULL REFERENCES ad_teams(id) ON DELETE CASCADE,
  day      date NOT NULL,
  runs     int  NOT NULL DEFAULT 0,
  tokens   bigint NOT NULL DEFAULT 0,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, team_id, day)
);
CREATE INDEX IF NOT EXISTS ad_chargeback_org ON ad_chargeback(org_id, day DESC);
ALTER TABLE ad_chargeback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON ad_chargeback;
CREATE POLICY service_all ON ad_chargeback FOR ALL TO service_role USING (true) WITH CHECK (true);
