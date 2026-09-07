-- Behavioral drift detection tables.
-- Run after create_moats.sql. Safe to re-run (all IF NOT EXISTS).

-- NOTE: ad_drift_profiles was removed from this migration.
--
-- It was designed to persist per-org/agent behavioural baselines, but nothing
-- ever wrote to or read from it: lib/drift.ts computes both baseline and current
-- windows in memory from ad_run_rollups on every call. It held 0 rows in
-- production. New deployments no longer create it.
--
-- Deliberately NOT dropped here: an existing deployment keeps the empty table
-- until someone drops it by hand. A migration that silently drops a table is a
-- worse habit than an unused one, and this file is documented as safe to re-run.

-- Drift detection results written by the daily cron.
-- One row per org/agent/day when drift is detected.
CREATE TABLE IF NOT EXISTS ad_drift_alerts (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id           uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent            text        NOT NULL DEFAULT '*',
  detected_at      timestamptz NOT NULL DEFAULT now(),
  severity         text        NOT NULL DEFAULT 'info',   -- 'info'|'warning'|'critical'
  drift_score      numeric(6,2) NOT NULL DEFAULT 0,       -- 0-100 composite
  signals          jsonb       NOT NULL DEFAULT '[]',     -- [{metric,label,unit,baseline_mean,current_mean,z_score,pct_change,direction,severity}]
  baseline_start   date,
  baseline_end     date,
  current_start    date,
  current_end      date,
  baseline_runs    integer     NOT NULL DEFAULT 0,
  current_runs     integer     NOT NULL DEFAULT 0,
  acknowledged_at  timestamptz,
  acknowledged_by  text
);
CREATE INDEX IF NOT EXISTS ad_drift_alerts_org     ON ad_drift_alerts(org_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS ad_drift_alerts_unacked ON ad_drift_alerts(org_id, severity) WHERE acknowledged_at IS NULL;
