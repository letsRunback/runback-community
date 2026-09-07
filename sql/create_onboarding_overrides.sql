-- Migration 59: onboarding step overrides.
-- Setup progress (web/lib/onboardingProgress.ts) is live-derived from real
-- data (has a real run, a policy, an alert, a teammate) — there's no stored
-- "onboarding_state" flag. That's correct for auto-detection, but a user who
-- did the underlying task a different way (e.g. a policy imported via the
-- API, not the UI) or who just wants to dismiss a step needs a manual
-- "mark done" escape hatch. This table holds that manual override; final
-- done-ness is live-detected OR manually marked, whichever is true first.
CREATE TABLE IF NOT EXISTS onboarding_step_overrides (
  org_id          text NOT NULL,
  step_id         text NOT NULL,
  marked_done_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, step_id)
);
ALTER TABLE onboarding_step_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON onboarding_step_overrides FOR ALL TO service_role USING (true);
