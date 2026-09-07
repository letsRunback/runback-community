-- bump_usage_capped's RETURNS TABLE(allowed boolean, runs integer) implicitly
-- declares `runs` as an OUT-parameter variable in scope for the whole function
-- body — colliding with usage_counters.runs. Postgres correctly refuses to
-- guess which `runs` is meant, so both `SELECT runs INTO v FROM usage_counters`
-- and `UPDATE ... RETURNING runs INTO v` throw "column reference \"runs\" is
-- ambiguous" — discovered by actually calling this function end-to-end (a
-- real self-hosted ingest, not a mocked unit test), not found until now
-- because every hosted-cloud org exercised in prior testing was on an
-- unlimited-plan (Infinity limit), which meterIngest() short-circuits BEFORE
-- ever calling this RPC (see web/lib/usage.ts). Any org on a metered (capped)
-- plan — every free-tier org, every self-host default — hit this on their
-- very first ingest past the initial insert, and meterIngest() fails CLOSED
-- on an RPC error (by design, correctly), so the failure mode was "ingest
-- silently rejected with a 429 claiming 0/1000 used," not a crash anyone
-- would immediately trace back here.
--
-- Fix: qualify every reference to the column with its table name so it can
-- never again be confused with the OUT parameter of the same name.
CREATE OR REPLACE FUNCTION bump_usage_capped(p_org uuid, p_period text, p_n integer, p_limit integer)
RETURNS TABLE(allowed boolean, runs integer) LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  INSERT INTO usage_counters (org_id, period, runs)
  VALUES (p_org, p_period, 0)
  ON CONFLICT (org_id, period) DO NOTHING;

  SELECT usage_counters.runs INTO v FROM usage_counters
  WHERE org_id = p_org AND period = p_period
  FOR UPDATE;

  IF p_limit IS NOT NULL AND v + p_n > p_limit THEN
    RETURN QUERY SELECT false, v;
    RETURN;
  END IF;

  UPDATE usage_counters SET runs = usage_counters.runs + p_n, updated_at = now()
  WHERE org_id = p_org AND period = p_period
  RETURNING usage_counters.runs INTO v;

  RETURN QUERY SELECT true, v;
END;
$$;
GRANT EXECUTE ON FUNCTION bump_usage_capped(uuid, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
