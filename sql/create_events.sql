-- The high-volume table: one row per trace event (LLM call, tool call, reasoning,
-- run lifecycle). Append-only. Typed columns drive cheap list rendering; the full
-- TraceEvent (including the heavy request.messages array) lives only in `data`.
CREATE TABLE IF NOT EXISTS ad_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES ad_runs(run_id) ON DELETE CASCADE,
  span_id text NOT NULL,
  parent_span_id text,
  seq integer NOT NULL,
  type text NOT NULL,                   -- llm | tool | reasoning | run | env
  ts_start timestamptz NOT NULL,
  ts_end timestamptz,
  latency_ms integer,
  -- denormalised columns for fast list views (never deserialize `data` to render the rail)
  model_id text,
  tool_name text,
  tool_call_id text,
  total_tokens integer,
  error jsonb,
  data jsonb NOT NULL,                  -- the full TraceEvent
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, span_id)              -- idempotent ingest; SDK retries can't double-insert
);
ALTER TABLE ad_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_events FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_events_run_seq_idx ON ad_events(run_id, seq);          -- ordered timeline
CREATE INDEX IF NOT EXISTS ad_events_run_parent_idx ON ad_events(run_id, parent_span_id); -- tree
