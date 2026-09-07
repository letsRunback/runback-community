-- Starter tier — a self-serve plan between Free and Pro for small teams.
-- Widens the org plan enum to allow 'starter'.
ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_plan_check;
ALTER TABLE orgs ADD CONSTRAINT orgs_plan_check CHECK (plan IN ('free','starter','pro','enterprise'));
