-- Structured, historical results from .github/workflows/determinism-proof.yml
-- (native/linux record/replay proof tiers). Deliberately global/public-ish
-- proof data, not customer/org data — no FK to orgs, unlike ad_benchmarks.
-- Safe to re-run — all statements are idempotent.

CREATE TABLE IF NOT EXISTS ci_determinism_runs (
  id               bigserial PRIMARY KEY,
  commit_sha       text NOT NULL,
  workflow_run_id  text NOT NULL,
  tier             text NOT NULL,
  metric           text NOT NULL,
  value            numeric NOT NULL,
  unit             text,
  status           text NOT NULL DEFAULT 'pass',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ci_determinism_runs_created_at_idx ON ci_determinism_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS ci_determinism_runs_tier_idx ON ci_determinism_runs (tier, created_at DESC);

-- Inserted only via the CI workflow's service-role key (REST insert); read
-- only via the admin client on /verify. No anon/authenticated access needed.
ALTER TABLE ci_determinism_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ci_determinism_runs FOR ALL TO service_role USING (true);
