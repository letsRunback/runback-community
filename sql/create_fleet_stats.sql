-- Run this after create_moats.sql (which creates ad_model_diffs).
-- Safe to re-run — all statements are idempotent.

-- ── 1. Fleet-wide benchmark statistics ──────────────────────────────────────
-- Populated by /api/cron/benchmark daily. No FK on org_id — fleet aggregate.
CREATE TABLE IF NOT EXISTS ad_fleet_stats (
  metric        text        NOT NULL,
  window_days   integer     NOT NULL DEFAULT 30,
  fleet_median  numeric     NOT NULL,
  fleet_p90     numeric     NOT NULL,
  org_count     integer     NOT NULL DEFAULT 0,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric, window_days)
);

-- ── 2. Extend ad_model_diffs with token/rate columns ────────────────────────
-- Required so the cached path returns real data instead of zeros.
-- Uses a DO block so the script is safe even if ad_model_diffs already has
-- some of these columns.
DO $$
BEGIN
  ALTER TABLE ad_model_diffs ADD COLUMN IF NOT EXISTS a_avg_tokens    integer;
  ALTER TABLE ad_model_diffs ADD COLUMN IF NOT EXISTS b_avg_tokens    integer;
  ALTER TABLE ad_model_diffs ADD COLUMN IF NOT EXISTS token_delta_pct numeric(8,2);
  ALTER TABLE ad_model_diffs ADD COLUMN IF NOT EXISTS a_error_rate    numeric(6,4);
  ALTER TABLE ad_model_diffs ADD COLUMN IF NOT EXISTS b_error_rate    numeric(6,4);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'ad_model_diffs does not exist yet — run create_moats.sql first, then re-run this file.';
END $$;
