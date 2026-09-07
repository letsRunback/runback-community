-- One row per agent invocation. The envelope the Timeline header renders.
CREATE TABLE IF NOT EXISTS ad_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL UNIQUE,          -- ULID from the SDK (idempotent ingest key)
  project_id uuid NOT NULL,             -- = api_keys.id (billing / scope boundary)
  name text NOT NULL,
  status text NOT NULL DEFAULT 'running', -- running | success | error
  input jsonb,
  output jsonb,
  error jsonb,
  metadata jsonb NOT NULL DEFAULT '{}',
  step_count integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ad_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_runs FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_runs_project_created_idx ON ad_runs(project_id, created_at DESC);
