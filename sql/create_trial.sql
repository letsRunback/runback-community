-- Free trial: new orgs get full features for a window, then fall back to free.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
