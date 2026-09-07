-- Captures "cancelled, access ends on X" so the in-app cancel/resume UI
-- survives a page reload instead of only being knowable via the LemonSqueezy
-- hosted portal. Populated by the billing webhook and the nightly
-- billing-reconcile cron, both of which already read these fields from
-- LemonSqueezy. Safe to re-run.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS subscription_status text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS subscription_ends_at timestamptz;
