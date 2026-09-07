-- Tenant-scope evals so they show up per workspace in /app.
ALTER TABLE ad_datasets  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE ad_eval_runs ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES orgs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ad_datasets_org_idx ON ad_datasets(org_id);
CREATE INDEX IF NOT EXISTS ad_eval_runs_org_idx ON ad_eval_runs(org_id);
