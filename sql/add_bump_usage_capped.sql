-- meterIngest() (web/lib/usage.ts) used to read usage_counters, compare
-- against the plan cap in application code, and only THEN call bump_usage —
-- two separate round trips with no lock between them. bump_usage's own
-- comment claimed "cap checks are O(1) and concurrency-safe", but the atomic
-- part was only the increment: two concurrent ingest requests near the
-- ceiling could both pass the read-time check and both commit, overshooting
-- the limit by up to (concurrent request count - 1) x batch size.
--
-- bump_usage_capped does the read, cap check, and increment as ONE
-- statement sequence inside a single function call, with `FOR UPDATE` row
-- locking the (org_id, period) counter for the duration — a second
-- concurrent caller blocks until the first transaction commits, then sees
-- the updated value. p_limit = NULL means unlimited (the app's Infinity).
CREATE OR REPLACE FUNCTION bump_usage_capped(p_org uuid, p_period text, p_n integer, p_limit integer)
RETURNS TABLE(allowed boolean, runs integer) LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  INSERT INTO usage_counters (org_id, period, runs)
  VALUES (p_org, p_period, 0)
  ON CONFLICT (org_id, period) DO NOTHING;

  SELECT runs INTO v FROM usage_counters
  WHERE org_id = p_org AND period = p_period
  FOR UPDATE;

  IF p_limit IS NOT NULL AND v + p_n > p_limit THEN
    RETURN QUERY SELECT false, v;
    RETURN;
  END IF;

  UPDATE usage_counters SET runs = runs + p_n, updated_at = now()
  WHERE org_id = p_org AND period = p_period
  RETURNING runs INTO v;

  RETURN QUERY SELECT true, v;
END;
$$;
GRANT EXECUTE ON FUNCTION bump_usage_capped(uuid, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
