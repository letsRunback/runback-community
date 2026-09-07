-- Self-recorded availability history, and the public status page behind it.
--
-- WHY NOT A PAID MONITOR
-- Betterstack/Pingdom cost money this product does not have yet. What they
-- provide that matters for a security review is a public URL showing honest
-- uptime, and that is a table and a page.
--
-- THE LIMITATION, STATED UP FRONT
-- A deployment cannot reliably observe its own total failure: if the app is
-- down, the cron that records the check does not run either. So a hard outage
-- appears here as a GAP in the record rather than as a red bar. The status page
-- says so, and treats a stale last-check as degraded rather than as healthy —
-- silence is not evidence of health.
--
-- The complete answer is an external prober hitting /api/health, which several
-- services do free. This gives the history, the public page and the alerting
-- without one; adding a prober later strengthens it rather than replacing it.

CREATE TABLE IF NOT EXISTS ad_uptime_checks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  ok         boolean NOT NULL,
  latency_ms integer,
  detail     text                          -- why it failed; null when healthy
);

CREATE INDEX IF NOT EXISTS ad_uptime_checks_recent ON ad_uptime_checks(checked_at DESC);

ALTER TABLE ad_uptime_checks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_uptime_checks' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON ad_uptime_checks FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- Daily rollup for the status page: one row per day rather than 288 checks.
--
-- Computed in the database so the page renders from a small result regardless
-- of history length — the same reason the compliance figures moved here.
CREATE OR REPLACE FUNCTION uptime_summary(p_days integer DEFAULT 90)
RETURNS TABLE(
  day        date,
  checks     bigint,
  failures   bigint,
  uptime_pct numeric,
  p50_ms     integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (checked_at AT TIME ZONE 'UTC')::date              AS day,
    count(*)::bigint                                   AS checks,
    count(*) FILTER (WHERE NOT ok)::bigint             AS failures,
    -- Rounded to two places: claiming 99.9983% from a handful of samples would
    -- be precision the sample size does not support.
    round(100.0 * count(*) FILTER (WHERE ok) / NULLIF(count(*), 0), 2) AS uptime_pct,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms)::integer   AS p50_ms
  FROM ad_uptime_checks
  WHERE checked_at >= now() - make_interval(days => p_days)
  GROUP BY 1
  ORDER BY 1 DESC;
$$;
