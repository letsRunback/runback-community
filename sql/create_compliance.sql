-- Compliance artifact cache: stores generated compliance report metadata so
-- reports can be retrieved without recomputing. Reports expire after 24h.
CREATE TABLE IF NOT EXISTS ad_compliance_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  report        jsonb NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  generated_by  uuid,          -- user_id who requested
  UNIQUE (org_id, period_start, period_end)
);
ALTER TABLE ad_compliance_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_compliance_reports FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_compliance_org_idx ON ad_compliance_reports(org_id, generated_at DESC);
