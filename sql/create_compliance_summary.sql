-- Compute the compliance report's figures in the database, exactly.
--
-- WHY
-- The report was assembled by shipping rows to the application and summing
-- them, with two silent truncations stacked:
--
--   * runs were fetched with .limit(10000)
--   * policy enforcement was then computed from runs.slice(0, 1000)
--
-- Neither was surfaced. An org with more than a thousand runs in the period
-- got a report whose "Total blocks" and "Calls evaluated" covered a fraction of
-- it, presented as totals. On top of that, PostgREST caps rows per request
-- (db-max-rows), so an unbounded read returns a prefix with no marker saying so.
--
-- For most products a truncated aggregate is a wrong dashboard. Here it is a
-- confident, precise, wrong number in the artifact a customer hands a regulator
-- — the one output whose entire value is being trustworthy. Raising the limits
-- only moves the cliff; the fix is to stop moving rows at all.
--
-- Aggregating server-side is exact regardless of volume, costs one round trip
-- instead of thousands of rows over the wire, and lets the planner use the
-- existing (org_id, …) indexes.
--
-- Filters on ad_events.org_id directly rather than through a list of run ids,
-- which is what made the 1000-run cap necessary in the first place. That column
-- exists as of sql/scope_run_id_per_org.sql.

CREATE OR REPLACE FUNCTION compliance_summary(
  p_org uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH run_agg AS (
    SELECT
      count(*)                                              AS total,
      count(*) FILTER (WHERE status = 'success')            AS success,
      count(*) FILTER (WHERE status = 'error')              AS errors,
      COALESCE(sum(total_tokens), 0)                        AS tokens,
      COALESCE(sum(step_count), 0)                          AS steps,
      COALESCE(sum(redaction_count), 0)                     AS redactions
    FROM ad_runs
    WHERE org_id = p_org
      -- Completed runs only. An in-flight run is neither a success nor a
      -- failure, and counting it would move the error rate as it finishes.
      AND status IN ('success', 'error')
      AND created_at >= p_start
      AND created_at <= p_end
  ),
  redaction_types AS (
    -- redaction_by_type is a jsonb map per run; sum the counts across runs.
    SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) AS by_type
    FROM (
      SELECT kv.key AS k, sum((kv.value)::numeric)::bigint AS n
      FROM ad_runs r
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(r.redaction_by_type, '{}'::jsonb)) AS kv(key, value)
      WHERE r.org_id = p_org
        AND r.status IN ('success', 'error')
        AND r.created_at >= p_start
        AND r.created_at <= p_end
      GROUP BY kv.key
    ) s
  ),
  eval_agg AS (
    SELECT
      count(*) FILTER (WHERE policy_evaluated) AS evaluations,
      count(*) FILTER (WHERE policy_blocked)   AS blocks
    FROM ad_events
    WHERE org_id = p_org
      AND type = 'tool'
      AND ts_start >= p_start
      AND ts_start <= p_end
  ),
  blocks_by_policy AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'policy_name', name, 'blocks', n, 'last_block_at', last_at
           ) ORDER BY n DESC), '[]'::jsonb) AS rows
    FROM (
      SELECT
        COALESCE(e.data -> 'policy_block' ->> 'rule', 'unnamed') AS name,
        count(*)      AS n,
        max(e.ts_start) AS last_at
      FROM ad_events e
      WHERE e.org_id = p_org
        AND e.type = 'tool'
        AND e.policy_blocked
        AND e.ts_start >= p_start
        AND e.ts_start <= p_end
      GROUP BY 1
    ) b
  )
  SELECT jsonb_build_object(
    'runs_total',       (SELECT total       FROM run_agg),
    'runs_success',     (SELECT success     FROM run_agg),
    'runs_errors',      (SELECT errors      FROM run_agg),
    'tokens_total',     (SELECT tokens      FROM run_agg),
    'steps_total',      (SELECT steps       FROM run_agg),
    'redactions_total', (SELECT redactions  FROM run_agg),
    'redactions_by_type', (SELECT by_type   FROM redaction_types),
    'policy_evaluations', (SELECT evaluations FROM eval_agg),
    'policy_blocks',      (SELECT blocks      FROM eval_agg),
    'blocks_by_policy',   (SELECT rows        FROM blocks_by_policy)
  );
$$;

-- Serves both the run window and the event window used above.
CREATE INDEX IF NOT EXISTS ad_runs_org_created_idx ON ad_runs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_events_org_tool_ts_idx
  ON ad_events(org_id, ts_start) WHERE type = 'tool';
