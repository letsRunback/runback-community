-- Policy causal attribution rollup: which policies fire, against which agents, how often.
CREATE TABLE IF NOT EXISTS ad_policy_causes (
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  day           date NOT NULL,
  policy_name   text NOT NULL,
  agent         text NOT NULL,
  block_count   int  NOT NULL DEFAULT 0,
  run_count     int  NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day, policy_name, agent)
);
CREATE INDEX IF NOT EXISTS ad_policy_causes_org ON ad_policy_causes(org_id, day DESC);
ALTER TABLE ad_policy_causes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON ad_policy_causes;
CREATE POLICY service_all ON ad_policy_causes FOR ALL TO service_role USING (true) WITH CHECK (true);
