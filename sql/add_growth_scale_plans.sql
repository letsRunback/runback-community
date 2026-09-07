-- entitlements.ts and billing.ts both treat 'growth'/'scale' as first-class
-- paid plans (own LemonSqueezy variant env vars, full feature/limit maps),
-- but the live orgs_plan_check constraint (sql/create_starter.sql) never
-- included them — a real Growth/Scale subscriber's webhook-driven
-- `orgs.plan = 'growth'` write would violate the constraint and fail.
-- Safe to re-run.
ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_plan_check;
ALTER TABLE orgs ADD CONSTRAINT orgs_plan_check
  CHECK (plan IN ('free','starter','growth','scale','pro','enterprise'));
