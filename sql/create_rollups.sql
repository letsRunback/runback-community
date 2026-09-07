-- Scale: precomputed per-day/per-agent rollups so the dashboard reads ~tens of
-- rows instead of scanning millions of runs. Incremented at ingest; backfillable.
CREATE TABLE IF NOT EXISTS ad_run_rollups (
  org_id        uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  day           date   NOT NULL,
  agent         text   NOT NULL,
  runs          bigint NOT NULL DEFAULT 0,    -- completed (success+error)
  errors        bigint NOT NULL DEFAULT 0,
  success       bigint NOT NULL DEFAULT 0,
  tokens        bigint NOT NULL DEFAULT 0,
  latency_sum   bigint NOT NULL DEFAULT 0,    -- ms, for avg
  latency_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day, agent)
);
CREATE INDEX IF NOT EXISTS ad_run_rollups_org_day ON ad_run_rollups(org_id, day DESC);

-- Atomic increment for one finished run.
CREATE OR REPLACE FUNCTION bump_rollup(
  p_org uuid, p_day date, p_agent text,
  p_runs int, p_err int, p_succ int, p_tok bigint, p_lat_sum bigint, p_lat_cnt int
) RETURNS void AS $$
  INSERT INTO ad_run_rollups(org_id, day, agent, runs, errors, success, tokens, latency_sum, latency_count)
  VALUES (p_org, p_day, p_agent, p_runs, p_err, p_succ, p_tok, p_lat_sum, p_lat_cnt)
  ON CONFLICT (org_id, day, agent) DO UPDATE SET
    runs          = ad_run_rollups.runs          + EXCLUDED.runs,
    errors        = ad_run_rollups.errors        + EXCLUDED.errors,
    success       = ad_run_rollups.success        + EXCLUDED.success,
    tokens        = ad_run_rollups.tokens        + EXCLUDED.tokens,
    latency_sum   = ad_run_rollups.latency_sum   + EXCLUDED.latency_sum,
    latency_count = ad_run_rollups.latency_count + EXCLUDED.latency_count;
$$ LANGUAGE sql;

-- One-shot (idempotent) recompute from raw — initial backfill or repair.
CREATE OR REPLACE FUNCTION backfill_rollups(p_org uuid, p_since_days int DEFAULT 90)
RETURNS bigint AS $$
  WITH agg AS (
    INSERT INTO ad_run_rollups(org_id, day, agent, runs, errors, success, tokens, latency_sum, latency_count)
    SELECT org_id,
      (created_at AT TIME ZONE 'UTC')::date AS day,
      COALESCE(name, 'agent') AS agent,
      count(*) AS runs,
      count(*) FILTER (WHERE status = 'error')   AS errors,
      count(*) FILTER (WHERE status = 'success') AS success,
      COALESCE(sum(total_tokens), 0) AS tokens,
      COALESCE(sum(CASE WHEN started_at IS NOT NULL AND ended_at IS NOT NULL
                         AND ended_at >= started_at
                         AND extract(epoch FROM (ended_at - started_at)) * 1000 < 3600000
                    THEN (extract(epoch FROM (ended_at - started_at)) * 1000)::bigint ELSE 0 END), 0) AS latency_sum,
      count(*) FILTER (WHERE started_at IS NOT NULL AND ended_at IS NOT NULL
                        AND ended_at >= started_at
                        AND extract(epoch FROM (ended_at - started_at)) * 1000 < 3600000) AS latency_count
    FROM ad_runs
    WHERE org_id = p_org AND status IN ('success', 'error')
      AND created_at >= now() - (p_since_days || ' days')::interval
      -- Exclude TODAY: bump_rollup owns the current day (it increments per run-end
      -- ingest), so backfilling it would REPLACE and lose runs that complete mid-
      -- backfill. Past days are immutable, so backfilling them races with nothing.
      AND (created_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'UTC')::date
    GROUP BY org_id, day, agent
    ON CONFLICT (org_id, day, agent) DO UPDATE SET
      runs=EXCLUDED.runs, errors=EXCLUDED.errors, success=EXCLUDED.success,
      tokens=EXCLUDED.tokens, latency_sum=EXCLUDED.latency_sum, latency_count=EXCLUDED.latency_count
    RETURNING 1
  )
  SELECT count(*) FROM agg;
$$ LANGUAGE sql;

-- Tiered retention: drop bulky event payloads but keep the run summary + digest
-- + ledger entry (the record stays provable after the payloads age out).
ALTER TABLE ad_runs ADD COLUMN IF NOT EXISTS payloads_pruned boolean NOT NULL DEFAULT false;
