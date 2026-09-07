-- Phase 1 — Eval. Turn captured runs into regression test suites.
-- A dataset is a set of captured LLM steps + the assertions they should satisfy.
-- An eval run replays each item against a model and scores the output.

CREATE TABLE IF NOT EXISTS ad_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ad_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_datasets FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_datasets_project_idx ON ad_datasets(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_dataset_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES ad_datasets(id) ON DELETE CASCADE,
  -- where this case came from (provenance)
  source_run_id text,
  source_span_id text,
  -- the captured LLM request to replay (system/messages/tools/params + model)
  request jsonb NOT NULL,
  model jsonb NOT NULL,              -- { provider, model_id } captured
  -- the assertions this case must satisfy (array of ScorerConfig)
  scorers jsonb NOT NULL DEFAULT '[]',
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ad_dataset_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_dataset_items FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_dataset_items_dataset_idx ON ad_dataset_items(dataset_id);

CREATE TABLE IF NOT EXISTS ad_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  dataset_id uuid NOT NULL REFERENCES ad_datasets(id) ON DELETE CASCADE,
  name text,
  model_id text,                    -- model the eval ran against (null = each item's captured model)
  status text NOT NULL DEFAULT 'running',  -- running | done | error
  total integer NOT NULL DEFAULT 0,
  passed integer NOT NULL DEFAULT 0,
  pass_rate numeric,
  baseline_eval_id uuid,            -- for regression diffing (the Gate)
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
ALTER TABLE ad_eval_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_eval_runs FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_eval_runs_dataset_idx ON ad_eval_runs(dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_eval_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_run_id uuid NOT NULL REFERENCES ad_eval_runs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES ad_dataset_items(id) ON DELETE CASCADE,
  passed boolean NOT NULL,
  results jsonb NOT NULL,            -- array of per-scorer ScoreResult
  output jsonb,                      -- the replayed output (text/tool_calls/finish/latency)
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ad_eval_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_eval_scores FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_eval_scores_run_idx ON ad_eval_scores(eval_run_id);
