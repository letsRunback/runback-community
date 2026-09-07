-- Cost attribution, aggregated in the database.
--
-- WHY
-- getCostAttribution() fetched every completed run in the window (unbounded),
-- then looked up model usage for `runIds.slice(0, 500)`. So `total_runs`
-- counted the whole window while the per-model and per-agent cost that
-- customers bill teams from covered at most five hundred runs — the report was
-- internally inconsistent with itself, and under-reported silently.
--
-- Same class as the compliance truncation, with money attached: a team billed
-- from a number that quietly omits most of its usage will find out, and the
-- conversation is about trust rather than a limit constant.
--
-- Grouping by (agent, model) in one pass lets the caller roll up either way
-- without a second query, and needs no run-id list — ad_events carries org_id
-- since sql/scope_run_id_per_org.sql.

CREATE OR REPLACE FUNCTION cost_summary(
  p_org   uuid,
  p_since timestamptz
)
RETURNS TABLE(
  agent_name text,
  model_id   text,
  runs       bigint,
  tokens     bigint,
  errors     bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH scoped AS (
    SELECT r.run_id, r.name, r.status
    FROM ad_runs r
    WHERE r.org_id = p_org
      AND r.started_at >= p_since
      AND r.status IN ('success', 'error')
  ),
  -- One model per run: the first LLM call decides which model the run is
  -- attributed to, matching what the application did when it took the first
  -- event it saw per run.
  run_model AS (
    SELECT DISTINCT ON (e.run_id)
           e.run_id, e.model_id
    FROM ad_events e
    JOIN scoped s ON s.run_id = e.run_id
    WHERE e.org_id = p_org
      AND e.type = 'llm'
      AND e.model_id IS NOT NULL
    ORDER BY e.run_id, e.seq
  ),
  run_tokens AS (
    SELECT e.run_id, COALESCE(sum(e.total_tokens), 0)::bigint AS tokens
    FROM ad_events e
    JOIN scoped s ON s.run_id = e.run_id
    WHERE e.org_id = p_org
      AND e.type = 'llm'
    GROUP BY e.run_id
  )
  SELECT
    s.name                                   AS agent_name,
    rm.model_id                              AS model_id,
    count(*)::bigint                         AS runs,
    COALESCE(sum(rt.tokens), 0)::bigint      AS tokens,
    count(*) FILTER (WHERE s.status = 'error')::bigint AS errors
  FROM scoped s
  JOIN run_model rm ON rm.run_id = s.run_id
  LEFT JOIN run_tokens rt ON rt.run_id = s.run_id
  GROUP BY s.name, rm.model_id
  ORDER BY tokens DESC;
$$;

-- Serves the window scan and the per-run model lookup.
CREATE INDEX IF NOT EXISTS ad_runs_org_started_idx ON ad_runs(org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ad_events_org_llm_run_idx
  ON ad_events(org_id, run_id, seq) WHERE type = 'llm';
