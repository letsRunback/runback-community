-- Migration 56: tag each cached model-diff report with how it was produced.
-- Existing rows predate the real counterfactual-replay path and are all the
-- old statistical-comparison methodology — default them explicitly so a
-- stale statistical cache can never be served as if it were a verified replay.
ALTER TABLE ad_model_diffs
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'statistical';
