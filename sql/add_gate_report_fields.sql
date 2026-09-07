-- Migration 58: record what a gate run actually verified.
-- method distinguishes real counterfactual replay (Enterprise/demo) from the
-- production-history heuristic (everyone else) — same reasoning as
-- ad_model_diffs.method. pass_threshold/warn_threshold record the exact bar
-- this specific run was judged against, so a later change to the org's
-- default threshold doesn't retroactively reinterpret a past verdict.
ALTER TABLE ad_upgrade_gates
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'statistical',
  ADD COLUMN IF NOT EXISTS pass_threshold numeric(4,3) NOT NULL DEFAULT 0.950,
  ADD COLUMN IF NOT EXISTS warn_threshold numeric(4,3) NOT NULL DEFAULT 0.800;
