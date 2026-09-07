-- Link golden entries to their source dataset; add approval fields.
ALTER TABLE ad_golden ADD COLUMN IF NOT EXISTS dataset_id uuid REFERENCES ad_datasets(id) ON DELETE SET NULL;
ALTER TABLE ad_golden ADD COLUMN IF NOT EXISTS approved_by text;  -- user email
ALTER TABLE ad_golden ADD COLUMN IF NOT EXISTS approved_at timestamptz;
CREATE INDEX IF NOT EXISTS ad_golden_dataset ON ad_golden(org_id, dataset_id) WHERE dataset_id IS NOT NULL;
