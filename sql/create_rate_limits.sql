-- Shared, cross-instance rate-limit store. The app's in-memory limiter is per
-- serverless instance (an attacker can spread requests across warm functions to
-- bypass it); this makes the limit global. The app calls rate_limit_hit() and
-- falls back to in-memory if this migration isn't applied, so it's optional and
-- safe to add later.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON rate_limits;
CREATE POLICY "service_all" ON rate_limits FOR ALL TO service_role USING (true);

-- One atomic hit: increments within the live window, resets when it has expired,
-- and returns whether the caller is under the limit. A single INSERT ... ON
-- CONFLICT statement, so it's race-free under concurrency across all instances.
CREATE OR REPLACE FUNCTION rate_limit_hit(p_key text, p_max integer, p_window_ms integer)
RETURNS TABLE(allowed boolean, retry_after integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_now   timestamptz := now();
  v_win   interval := make_interval(secs => p_window_ms / 1000.0);
  v_count integer;
  v_start timestamptz;
BEGIN
  INSERT INTO rate_limits AS rl (key, count, window_start)
    VALUES (p_key, 1, v_now)
  ON CONFLICT (key) DO UPDATE SET
    count        = CASE WHEN rl.window_start < v_now - v_win THEN 1     ELSE rl.count + 1     END,
    window_start = CASE WHEN rl.window_start < v_now - v_win THEN v_now ELSE rl.window_start END
  RETURNING rl.count, rl.window_start INTO v_count, v_start;

  IF v_count <= p_max THEN
    allowed := true;  retry_after := 0;
  ELSE
    allowed := false; retry_after := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_start + v_win - v_now))))::integer;
  END IF;
  RETURN NEXT;
END;
$$;

-- Prune expired buckets (call from the retention cron). Keeps the table tiny.
CREATE OR REPLACE FUNCTION rate_limit_gc(p_older_than_min integer DEFAULT 60)
RETURNS integer LANGUAGE sql AS $$
  WITH d AS (
    DELETE FROM rate_limits WHERE window_start < now() - make_interval(mins => p_older_than_min) RETURNING 1
  ) SELECT count(*)::integer FROM d;
$$;
