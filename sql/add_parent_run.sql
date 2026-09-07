-- Agent-to-agent trace stitching: link a child run to the orchestrating parent.
-- A child run sets parent_run_id in its RunEvent start metadata; the SDK and
-- gateway forward it. This enables the multi-agent graph in the run detail view.
ALTER TABLE ad_runs ADD COLUMN IF NOT EXISTS parent_run_id text REFERENCES ad_runs(run_id);
CREATE INDEX IF NOT EXISTS ad_runs_parent_idx ON ad_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
