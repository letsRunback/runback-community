-- Usage metering. Per-org, per-calendar-month run counters, incremented
-- atomically at ingest so cap checks are O(1) and concurrency-safe.
CREATE TABLE IF NOT EXISTS usage_counters (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  period text NOT NULL,                 -- 'YYYY-MM'
  runs integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, period)
);
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON usage_counters FOR ALL TO service_role USING (true);

-- Atomic increment: insert-or-add, returns the new running total.
CREATE OR REPLACE FUNCTION bump_usage(p_org uuid, p_period text, p_n integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  INSERT INTO usage_counters (org_id, period, runs)
  VALUES (p_org, p_period, p_n)
  ON CONFLICT (org_id, period)
  DO UPDATE SET runs = usage_counters.runs + p_n, updated_at = now()
  RETURNING runs INTO v;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION bump_usage(uuid, text, integer) TO service_role;

-- Let PostgREST pick up the new function (self-host).
NOTIFY pgrst, 'reload schema';
