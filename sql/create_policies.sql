-- Policy-as-code: versioned, org-wide governance policies the gate enforces.
-- Each save is an immutable new version, so an eval records exactly which policy
-- version it ran against (auditable). Plus regression-at-scale: a dataset's
-- designated baseline eval to diff candidates against.
CREATE TABLE IF NOT EXISTS ad_policies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       text   NOT NULL,
  version    int    NOT NULL DEFAULT 1,
  rules      jsonb  NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name, version)
);
CREATE INDEX IF NOT EXISTS ad_policies_org ON ad_policies(org_id, name, version DESC);

-- An eval can run against a specific policy version.
ALTER TABLE ad_eval_runs ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES ad_policies(id) ON DELETE SET NULL;

-- A dataset's designated baseline eval (for regression diffing).
ALTER TABLE ad_datasets ADD COLUMN IF NOT EXISTS baseline_eval_id uuid;
