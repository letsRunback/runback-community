-- Golden suite — production incidents auto-enrolled as permanent regression tests.
-- When a run goes "bad" (a runtime policy block, or an error), it is captured as a
-- re-runnable golden test, DEDUPED by the failing-decision signature so each
-- distinct failure mode is exactly one test. The suite is mined from reality and
-- grows with usage — a regression corpus a competitor starts at zero on.
CREATE TABLE IF NOT EXISTS ad_golden (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id          text NOT NULL,           -- the source run (the incident)
  reason          text NOT NULL,           -- policy_block | error
  signature       text NOT NULL,           -- dedup key: hash(reason + failing decision)
  detail          text,                    -- human-readable summary
  baseline_digest text,                    -- the run's cassette digest at enroll time
  status          text NOT NULL DEFAULT 'active',  -- active | dismissed
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_run_at     timestamptz,
  last_result     text,                    -- reproduced | diverged | missing
  UNIQUE (org_id, signature)               -- one test per distinct failure mode
);
CREATE INDEX IF NOT EXISTS ad_golden_org ON ad_golden(org_id, created_at DESC);

-- App scopes by org in code with the service-role key; lock the table to it.
ALTER TABLE ad_golden ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON ad_golden;
CREATE POLICY service_all ON ad_golden FOR ALL TO service_role USING (true) WITH CHECK (true);
