-- Vertical cohort benchmarks.
-- Safe to re-run (all IF NOT EXISTS / IF EXISTS).

-- 1. Add vertical classification to orgs.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'general';

-- 2. Extend ad_fleet_stats to support per-vertical rows.
--    'all' = cross-fleet (existing behaviour); anything else = vertical cohort.
ALTER TABLE ad_fleet_stats ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'all';

-- The old PK was (metric, window_days). Widen it to include vertical.
-- Back-fill existing rows to vertical='all' (already the column default).
DO $$
BEGIN
  -- Drop old PK if it's still (metric, window_days)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_fleet_stats_pkey'
      AND pg_get_constraintdef(oid) NOT LIKE '%vertical%'
  ) THEN
    ALTER TABLE ad_fleet_stats DROP CONSTRAINT ad_fleet_stats_pkey;
    ALTER TABLE ad_fleet_stats ADD PRIMARY KEY (metric, window_days, vertical);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- PK already correct or table missing — safe to ignore
  RAISE NOTICE 'ad_fleet_stats PK already updated or table missing: %', SQLERRM;
END $$;

-- 3. Add policy_compliance to the allowed metric set (documentation only — no constraint).
COMMENT ON COLUMN ad_fleet_stats.metric IS
  'error_rate | avg_latency_ms | token_efficiency | policy_compliance';
