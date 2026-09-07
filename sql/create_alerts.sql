-- Alerting (an Enterprise/paid feature) + the org plan that gates it.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free','pro','enterprise'));

CREATE TABLE IF NOT EXISTS alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('run_failure','error_rate','cost_spike')),
  threshold numeric NOT NULL DEFAULT 0,   -- error_rate: 0..1; cost_spike: USD; run_failure: unused
  window_min integer NOT NULL DEFAULT 60, -- evaluation window for rate/cost rules
  channel text NOT NULL CHECK (channel IN ('email','slack','webhook')),
  target text NOT NULL,                   -- email address, or webhook/Slack URL
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup / history so we don't spam on every event in a window.
CREATE TABLE IF NOT EXISTS alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id text,
  fired_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_rules_org_idx ON alert_rules(org_id);
CREATE INDEX IF NOT EXISTS alert_deliveries_rule_idx ON alert_deliveries(rule_id, fired_at);

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON alert_rules FOR ALL TO service_role USING (true);
CREATE POLICY "service_all" ON alert_deliveries FOR ALL TO service_role USING (true);
